import {resolveSubstackAuthor} from '../worker/substack.js';
import {DEFAULT_SUBSTACK} from '../shared/substack.js';

// A valid case variant exercises the generic profile path instead of the
// default author's preverified shortcut. No author or article is created.
const result=await resolveSubstackAuthor('https://substack.com/@UncleStockNotes');
if(!result.candidates.some(row=>row.url===DEFAULT_SUBSTACK.url))throw Error('Author profile did not resolve its actual publication');
console.log('Generic public author profile verified:',result.candidates.length,'publication candidates');
