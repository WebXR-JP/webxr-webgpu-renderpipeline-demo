import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

// ---------------------------------------------------------------------------
// Single source of truth for every tweakable value.
// Both the desktop lil-gui and the in-VR panel are generated from GROUPS.
// ---------------------------------------------------------------------------

export const TONE_MAPPINGS = [
	[ 'ACES', THREE.ACESFilmicToneMapping ],
	[ 'AgX', THREE.AgXToneMapping ],
	[ 'Neutral', THREE.NeutralToneMapping ],
	[ 'Reinhard', THREE.ReinhardToneMapping ],
	[ 'None', THREE.NoToneMapping ],
];

export const DEFAULTS = {
	bypass: false,

	bloomEnabled: true,
	bloomStrength: 0.9,
	bloomRadius: 0.5,
	bloomThreshold: 0.7,

	flareEnabled: false,
	flareIntensity: 1.0,
	flareThreshold: 0.6,
	flareSpacing: 0.25,
	flareAttenuation: 25,

	trailEnabled: false,
	trailDamp: 0.85,

	chromaEnabled: true,
	chromaStrength: 0.3,
	chromaScale: 1.1,

	exposure: 1.0,
	contrast: 1.05,
	saturation: 1.15,
	hue: 0.0,
	toneMapping: THREE.ACESFilmicToneMapping,

	vignetteEnabled: true,
	vignetteIntensity: 0.45,
	vignetteSmoothness: 0.6,

	scanEnabled: false,
	scanIntensity: 0.25,
	scanCount: 420,
	scanSpeed: 1.0,

	filmEnabled: true,
	filmIntensity: 0.12,

	msaa: true,
	fxaaEnabled: false,
	renderScale: 1.0,

	neonIntensity: 9.0,
	neonSpeed: 1.0,
	fogDensity: 0.016,
	starIntensity: 1.0,
	edgeGlow: 1.0,
};

export const params = { ...DEFAULTS };

/**
 * Keys that change the shape of the TSL node graph.
 * Changing them rebuilds the RenderPipeline output node (= shader recompile),
 * every other key is a plain uniform update.
 */
export const GRAPH_KEYS = new Set( [
	'bypass', 'bloomEnabled', 'flareEnabled', 'trailEnabled', 'chromaEnabled',
	'vignetteEnabled', 'scanEnabled', 'filmEnabled', 'fxaaEnabled', 'msaa',
] );

/** One TSL uniform per numeric param (shared by every pipeline / material). */
export const U = {};

for ( const [ key, value ] of Object.entries( DEFAULTS ) ) {

	if ( typeof value === 'number' && key !== 'toneMapping' ) U[ key ] = uniform( value );

}

export const GROUPS = [
	{
		id: 'bloom', label: 'Bloom', toggle: 'bloomEnabled', items: [
			{ key: 'bloomStrength', label: 'Strength', min: 0, max: 3, step: 0.01 },
			{ key: 'bloomRadius', label: 'Radius', min: 0, max: 1, step: 0.01 },
			{ key: 'bloomThreshold', label: 'Threshold', min: 0, max: 2, step: 0.01 },
		]
	},
	{
		id: 'flare', label: 'Lens Flare', toggle: 'flareEnabled', items: [
			{ key: 'flareIntensity', label: 'Intensity', min: 0, max: 3, step: 0.01 },
			{ key: 'flareThreshold', label: 'Threshold', min: 0, max: 2, step: 0.01 },
			{ key: 'flareSpacing', label: 'Ghost Spacing', min: 0.05, max: 0.6, step: 0.01 },
			{ key: 'flareAttenuation', label: 'Ghost Falloff', min: 1, max: 50, step: 0.5 },
		]
	},
	{
		id: 'chroma', label: 'Chromatic Ab.', toggle: 'chromaEnabled', items: [
			{ key: 'chromaStrength', label: 'Strength', min: 0, max: 3, step: 0.01 },
			{ key: 'chromaScale', label: 'Scale', min: 1, max: 1.5, step: 0.005 },
		]
	},
	{
		id: 'trail', label: 'Afterimage', toggle: 'trailEnabled', items: [
			{ key: 'trailDamp', label: 'Damp', min: 0.5, max: 0.98, step: 0.005 },
		]
	},
	{
		id: 'color', label: 'Color Grade', items: [
			{ key: 'exposure', label: 'Exposure', min: 0, max: 3, step: 0.01 },
			{ key: 'contrast', label: 'Contrast', min: 0.5, max: 2, step: 0.01 },
			{ key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.01 },
			{ key: 'hue', label: 'Hue Shift', min: - Math.PI, max: Math.PI, step: 0.01 },
			{ key: 'toneMapping', label: 'Tone Mapping', type: 'select', options: TONE_MAPPINGS },
		]
	},
	{
		id: 'vignette', label: 'Vignette', toggle: 'vignetteEnabled', items: [
			{ key: 'vignetteIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
			{ key: 'vignetteSmoothness', label: 'Smoothness', min: 0, max: 1, step: 0.01 },
		]
	},
	{
		id: 'crt', label: 'Scanlines', toggle: 'scanEnabled', items: [
			{ key: 'scanIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
			{ key: 'scanCount', label: 'Line Count', min: 50, max: 1000, step: 1 },
			{ key: 'scanSpeed', label: 'Scroll Speed', min: 0, max: 10, step: 0.1 },
		]
	},
	{
		id: 'film', label: 'Film Grain', toggle: 'filmEnabled', items: [
			{ key: 'filmIntensity', label: 'Intensity', min: 0, max: 1, step: 0.01 },
		]
	},
	{
		id: 'quality', label: 'Quality', items: [
			{ key: 'msaa', label: 'MSAA 4x (scene pass)', type: 'bool' },
			{ key: 'fxaaEnabled', label: 'FXAA', type: 'bool' },
			{ key: 'renderScale', label: 'Scene Pass Scale', min: 0.4, max: 1, step: 0.05 },
		]
	},
	{
		id: 'scene', label: 'Scene', items: [
			{ key: 'neonIntensity', label: 'Neon Intensity', min: 0, max: 25, step: 0.1 },
			{ key: 'neonSpeed', label: 'Neon Pulse Speed', min: 0, max: 5, step: 0.05 },
			{ key: 'edgeGlow', label: 'Building Edge Glow', min: 0, max: 4, step: 0.05 },
			{ key: 'fogDensity', label: 'Fog Density', min: 0, max: 0.05, step: 0.001 },
			{ key: 'starIntensity', label: 'Stars', min: 0, max: 3, step: 0.05 },
		]
	},
];

/** Presets only list the keys they change; everything else falls back to DEFAULTS. */
export const PRESETS = [
	{ name: 'Neon Dream', values: {} },
	{
		name: 'Clean', values: {
			bloomStrength: 0.5, bloomThreshold: 1.0, chromaEnabled: false, vignetteEnabled: false,
			filmEnabled: false, contrast: 1, saturation: 1, fxaaEnabled: true,
		}
	},
	{
		name: 'Retro CRT', values: {
			scanEnabled: true, scanIntensity: 0.45, chromaStrength: 1.2, filmIntensity: 0.4,
			vignetteIntensity: 0.75, saturation: 1.35, contrast: 1.25, bloomStrength: 1.4,
		}
	},
	{
		name: 'Dream Trail', values: {
			trailEnabled: true, trailDamp: 0.9, flareEnabled: true, bloomStrength: 1.8,
			bloomRadius: 0.8, bloomThreshold: 0.4, hue: - 0.25, chromaStrength: 0.6,
		}
	},
	{
		name: 'Overdrive', values: {
			flareEnabled: true, flareIntensity: 1.6, flareThreshold: 0.5, bloomStrength: 1.8,
			neonIntensity: 16, exposure: 1.25, saturation: 1.5, toneMapping: THREE.AgXToneMapping,
		}
	},
];
