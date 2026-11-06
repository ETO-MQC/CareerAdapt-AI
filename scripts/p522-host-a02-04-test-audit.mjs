import fs from 'node:fs';
import path from 'node:path';
import {desktop,write,sha} from './p522-host-a02-04-common.mjs';
const tests=['src/store/composer.test.ts','src/store/session.test.ts','src/store/session-switcher.test.ts','src/lib/inflight-turn-journal.test.ts','src/app/chat/composer/hooks/use-composer-draft.test.tsx'];
const inputs=[...tests,'vitest.setup.ts','vitest.config.ts','vite.config.ts'];
const audits=inputs.map(file=>{const s=fs.readFileSync(path.join(desktop,file),'utf8');return {file,sha256:sha(s),filesystemDeleteTokens:[...s.matchAll(/rmSync|unlinkSync|rmdirSync|fs\.rm\(|fs\.unlink\(|node:fs|fs\/promises/g)].map(m=>m[0]),cleanupLines:s.split('\n').map((v,i)=>({line:i+1,text:v.trim()})).filter(x=>/afterEach|finally|cleanup|removeItem|\.clear\(/.test(x.text))};});
write('test-cleanup-audit',{status:audits.some(a=>a.filesystemDeleteTokens.length)?'REVIEW_REQUIRED':'PASS_NO_FILESYSTEM_DELETE_IN_SELECTED_TESTS_OR_SETUP',audits,excluded:'electron/hardening.test.ts forbidden; Python pytest tmp_path cleanup not used; all test directories retained',framework:'Vitest cache disabled for this run; React cleanup affects DOM only'});
console.log(JSON.stringify({audits:audits.length,deleteTokens:audits.flatMap(a=>a.filesystemDeleteTokens)}));
