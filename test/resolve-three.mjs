/**
 * Resuelve el import "three" (que en el navegador lo da el importmap de
 * index.html) al envoltorio de pruebas, que reexporta three.js real con
 * un WebGLRenderer sustituido por un doble.
 */
export async function resolve(specifier, context, next) {
  if (specifier === 'three' || specifier.startsWith('three/')) {
    return {
      url: new URL('./three-gl-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
