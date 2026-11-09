import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./scripts/ts-loader.mjs', pathToFileURL('./'));
