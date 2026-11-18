// ==UserScript==
// @name         R134 compatibility for Echo Clothing and ULTRAbc
// @namespace    local.echo-clothing-compat
// @version      1.3.0
// @description  Fixes Echo image requests, default colors, toe-nail layers and texture mask paths. Loads ULTRAbc 6.5.
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
// @updateURL    https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js
// @downloadURL  https://cdn.jsdelivr.net/gh/VivianMoonlight/Vivians-Portable-Wardrobe@wardrobe-react/ViviansPortableWardrobeReactLoader.user.js
// ==/UserScript==

(() => {
    'use strict';

    const page = window;
    if (page.location.hostname !== 'www.bondageprojects.elementfx.com'
        || !page.location.pathname.startsWith('/R134/BondageClub/')) return;

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

        // Echo can now apply its cross-origin policy to a single Request.
        const forwarded = args.slice();
        forwarded[0] = request;
        forwarded[1] = undefined;
        return next(forwarded);
    }

    // 2. Legacy DefaultColor definitions on R134.
    function installDefaultColorRemap(mod) {
        const pendingDefaults = new WeakMap();
        const explicitPresets = new WeakSet();

        // Echo calls the original AssetAdd. Its calls to these two functions
        // still go through ModSDK, including for custom and mirrored assets.
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
                        color === 'Default' || /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(color)
                        || asset.Group.ColorSchema.includes(color)
                    )) {
                        layer.Color = [color, ...layer.Color.slice(1)];
                    }
                }
            }
            return next(args);
        });
    }

    // 3. Echo toe-nail textures use the BodyLower variant in their filenames.
    function installToeNailLayers(mod) {
        mod.hookFunction('AssetMapLayer', 0, (args, next) => {
            const [definition, asset, , assetDefinition] = args;
            const layer = next(args);
            if (asset.Name === '脚趾甲' && asset.DynamicGroupName === 'Shoes'
                && (layer.Name === '左' || layer.Name === '右')
                && definition.ParentGroup === undefined && assetDefinition.ParentGroup === undefined) {
                layer.ParentGroup = page.AssetParseParentGroup('BodyLower', {});
            }
            return layer;
        });
    }

    // 4. EchoV1 texture masks must strip the internal marker after mapping.
    function installTextureMaskPaths(mod) {
        const noMapPrefix = '@nomap/';
        function hasNoMapPrefix(mask) {
            return typeof mask?.Url === 'string' && mask.Url.startsWith(noMapPrefix);
        }

        // Echo maps at priority 0. Let it honor @nomap/ before stripping it.
        mod.hookFunction('GLDrawLoadTextureAlphaMask', -1, (args, next) => {
            const masks = args[5];
            if (!Array.isArray(masks) || !masks.some(hasNoMapPrefix)) return next(args);

            const forwarded = args.slice();
            forwarded[5] = masks.map(mask => hasNoMapPrefix(mask)
                ? { ...mask, Url: mask.Url.slice(noMapPrefix.length) }
                : mask);
            return next(forwarded);
        });
    }

    // 5. ULTRAbc 6.5 for the R134 Information Sheet.
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

    function install() {
        if (page[installed]) return;

        const sdk = page.bcModSdk;
        if (typeof sdk?.registerMod === 'function'
            && typeof page.CommonFetch === 'function'
            && typeof page.AssetMapLayer === 'function'
            && typeof page.AssetAssignDefaultColor === 'function'
            && typeof page.AssetParseParentGroup === 'function'
            && typeof page.GLDrawLoadTextureAlphaMask === 'function') {
            const mod = sdk.registerMod({
                name: modName,
                fullName: 'Echo Clothing Extension and ULTRAbc R134 compatibility',
                version: '1.3.0',
            });
            // ModSDK runs larger priorities first. Echo's hook has priority 0.
            mod.hookFunction('CommonFetch', 1, preserveImageRequest);
            installDefaultColorRemap(mod);
            installToeNailLayers(mod);
            installTextureMaskPaths(mod);
            page[installed] = true;
            console.info('[R134 compatibility] Echo image, default color, toe-nail and texture mask fixes installed.');
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
