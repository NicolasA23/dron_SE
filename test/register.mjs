/** Registra el resolver de "three" para las pruebas en Node. */
import { register } from 'node:module';
register('./resolve-three.mjs', import.meta.url);
