// ==UserScript==
// @name         R134 compatibility for Echo Clothing and ULTRAbc
// @namespace    local.echo-clothing-compat
// @version      1.5.0
// @description  Fixes Echo image requests and default colors, and R134 layer-priority editing. Loads ULTRAbc 6.5.
// @author       VIVianMoonlight
// @match        https://bondageprojects.elementfx.com/*
// @match        https://www.bondageprojects.elementfx.com/*
// @match        https://bondage-europe.com/*
// @match        https://www.bondage-europe.com/*
// @match        https://bondage-asia.com/*
// @match        https://www.bondage-asia.com/*
// @match        http://localhost:*/*
// @run-at       document-end
// @grant        none
// @updateURL    https://raw.githubusercontent.com/VivianMoonlight/Vivian-tool-kits/main/echo-clothing-r134-fix.user.js
// @downloadURL  https://raw.githubusercontent.com/VivianMoonlight/Vivian-tool-kits/main/echo-clothing-r134-fix.user.js
// ==/UserScript==

(() => {
    'use strict';

    const page = window;
    const modName = 'EchoClothingR134ImageFix';
    const installed = Symbol.for('local.echo-clothing-compat.r134.installed');
    const installDeadline = Date.now() + 60_000;

    // 1. Echo cross-origin image requests.
    function preserveImageRequest(args, next) {
        const [input, options] = args;
        if ((typeof input !== 'string' && !(input instanceof page.URL))
            || !options?.headers) return next(args);

        let request;
        try {
            const url = new page.URL(input, page.location.href);
            if ((url.protocol === 'http:' || url.protocol === 'https:')
                && url.origin !== page.location.origin) {
                const headers = new page.Headers(options.headers);
                if (headers.get('accept') === 'image/*') {
                    request = new page.Request(url.href, { headers });
                }
            }
        } catch {
            // Let the game's fetch chain handle invalid URLs or headers.
        }

        if (!request) return next(args);

        const forwarded = args.slice();
        forwarded[0] = request;
        forwarded[1] = undefined;
        return next(forwarded);
    }

    // 2. Legacy DefaultColor definitions on R134.
    function installDefaultColorRemap(mod) {
        const pendingDefaults = new WeakMap();
        const explicitPresets = new WeakSet();

        mod.hookFunction('AssetMapLayer', 0, (args, next) => {
            const [definition, asset, , assetDefinition] = args;
            const layer = next(args);
            const defaults = assetDefinition.DefaultColor;
            if (typeof defaults === 'string' || (Array.isArray(defaults) && defaults.length)) {
                pendingDefaults.set(asset, defaults);
                if (Array.isArray(definition.Color) && definition.Color.length) {
                    explicitPresets.add(layer);
                }
            }
            return layer;
        });

        mod.hookFunction('AssetAssignDefaultColor', 0, (args, next) => {
            const [asset] = args;
            const defaults = pendingDefaults.get(asset);
            if (defaults !== undefined) {
                pendingDefaults.delete(asset);
                const nativeSlots = new Set();

                for (const layer of asset.Layer) {
                    if (layer.AllowColorize && !layer.CopyLayerColor && explicitPresets.has(layer)) {
                        nativeSlots.add(layer.ColorIndex);
                    }
                }

                for (const layer of asset.Layer) {
                    if (!layer.AllowColorize || layer.CopyLayerColor || nativeSlots.has(layer.ColorIndex)) continue;
                    const color = Array.isArray(defaults) ? defaults[layer.ColorIndex] : defaults;
                    if (typeof color === 'string' && (
                        color === 'Default'
                        || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)
                        || asset.Group.ColorSchema.includes(color)
                    )) {
                        layer.Color = [color, ...layer.Color.slice(1)];
                    }
                }
            }
            return next(args);
        });
    }

    // 3–5 are disabled.

    // 6. ULTRAbc 6.5 for the R134 Information Sheet.
    function loadUltrabc() {
        const ultraUrl = 'https://cdn.jsdelivr.net/gh/tetris245/ULTRAbc@f0cda35d87082a8c270783260638b6e563d12cdc/ULTRAbc.js';
        const ultraIntegrity = 'sha384-nAA9wOf5/Nx4ASOIaYl4Phk1u/F6dOR3ypNLK6bmoj6XI9EjAUIcCCcj0jLTTO5D';

        if (page.UBCver) {
            if (page.UBCver !== '6.5') {
                console.warn('[R134 compatibility] Disable ULTRAbc in PCM and refresh.');
            }
            return;
        }

        const script = document.createElement('script');
        script.crossOrigin = 'anonymous';
        script.integrity = ultraIntegrity;
        script.src = ultraUrl;
        script.addEventListener('error', () => {
            console.error('[R134 compatibility] Could not load ULTRAbc 6.5.');
        }, { once: true });
        document.head.appendChild(script);
    }

    // 7. Optional WebGL translation override.
    function installWebGLTranslationFix(sdk, mod) {
        function sourceOf(name) {
            const original = sdk.getPatchingInfo().get(name)?.original ?? page[name];
            return typeof original === 'function' ? original.toString() : '';
        }

        const glName = 'GLDrawImage';
        const buildName = 'CommonDrawAppearanceBuild';
        const glSource = sourceOf(glName);
        const buildSource = sourceOf(buildName);
        const drawX = 'dstX + offsetX + (TranslationX || 0) * (Mirror ? 3 : 1)';
        const drawY = 'dstY + (1 * (TranslationY || 0))';
        const transforms = 'const { TranslationX, TranslationY, ScaleX, ScaleY, Rotation } = options ?? {};';

        if (glSource.includes(drawX) && glSource.includes(drawY) && glSource.includes(transforms)
            && buildSource.includes('const drawX = X + transforms.TranslationX;')
            && buildSource.includes('const drawY = Y + transforms.TranslationY;')) {
            const flagName = 'local.bc-native-compat.r134.translation-applied';
            const translated = Symbol.for(flagName);

            mod.patchFunction(glName, {
                [transforms]: transforms + `\nconst alreadyTranslated = options?.[Symbol.for(${JSON.stringify(flagName)})];`,
                [drawX]: 'dstX + offsetX + (TranslationX || 0) * (alreadyTranslated ? (Mirror ? 2 : 0) : (Mirror ? 3 : 1))',
                [drawY]: 'dstY + (TranslationY || 0) * (alreadyTranslated ? (Invert ? 2 : 0) : 1)',
            });

            // Mirror and Invert reverse the translated coordinates.
            // Compensate so each screen-space offset is applied once.
            mod.hookFunction(buildName, 0, (args, next) => {
                const callbacks = { ...args[1] };
                for (const name of [
                    'drawImage', 'drawImageBlink', 'drawImageColorize', 'drawImageColorizeBlink',
                    'drawCanvas', 'drawCanvasBlink',
                ]) {
                    const draw = callbacks[name];
                    if (typeof draw !== 'function') continue;

                    const optionIndex = name.startsWith('drawCanvas') ? 5 : 3;
                    callbacks[name] = function (...drawArgs) {
                        const options = drawArgs[optionIndex];
                        if (options?.TranslationX || options?.TranslationY) {
                            drawArgs[optionIndex] = { ...options, [translated]: true };
                        }
                        return draw.apply(this, drawArgs);
                    };
                }

                const forwarded = args.slice();
                forwarded[1] = callbacks;
                return next(forwarded);
            });

            console.info('[R134 transform fix] WebGL translation installed.');
        }
    }

    // 8. Allow the first per-layer priority edit when no override is set.
    function installLayerPriorityFix(sdk, mod) {
        const name = 'Layering._ApplyLayerPriority';
        const original = sdk.getPatchingInfo().get(name)?.original ?? page.Layering?._ApplyLayerPriority;
        const buggyGuard = 'if (this.OverridePriority === undefined || !this.Character) throw new Error("called before Layering.Init()");';

        if (typeof original !== 'function' || !original.toString().includes(buggyGuard)) return;

        mod.hookFunction(name, 0, (args, next) => {
            const layering = page.Layering;
            if (!layering?.Item || !layering.Character || layering.OverridePriority !== undefined) {
                return next(args);
            }

            // Let the original method convert a non-object priority into per-layer overrides.
            layering.OverridePriority = null;
            try {
                return next(args);
            } finally {
                if (layering.Item && layering.OverridePriority === null) {
                    layering.OverridePriority = undefined;
                }
            }
        });
    }

    function install() {
        if (page[installed]) return;

        const sdk = page.bcModSdk;
        if (typeof sdk?.registerMod === 'function'
            && typeof page.CommonFetch === 'function'
            && typeof page.AssetMapLayer === 'function'
            && typeof page.AssetAssignDefaultColor === 'function') {
            const mod = sdk.registerMod({
                name: modName,
                fullName: 'Echo Clothing Extension and ULTRAbc R134 compatibility',
                version: '1.5.0',
            });

            // ModSDK runs larger priorities first. Echo's hook has priority 0.
            mod.hookFunction('CommonFetch', 1, preserveImageRequest);
            installDefaultColorRemap(mod);
            // installWebGLTranslationFix(sdk, mod); // Preserve the game's WebGL translation behavior.
            installLayerPriorityFix(sdk, mod);

            page[installed] = true;
            console.info('[R134 compatibility] Echo compatibility fixes installed (1.5.0).');

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', loadUltrabc, { once: true });
            } else {
                loadUltrabc();
            }
        } else if (Date.now() < installDeadline) {
            page.setTimeout(install, 50);
        } else {
            console.warn('[R134 compatibility] Required ModSDK or R134 functions did not load.');
        }
    }

    install();
})();
