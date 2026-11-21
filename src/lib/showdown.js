import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const showdown = require('pokemon-showdown');

export const { Dex, Teams, BattleStream, getPlayerStreams, PRNG } = showdown;
export const toID = showdown.toID;
