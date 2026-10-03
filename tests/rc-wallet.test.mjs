import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

function config(env) {
  const exports = {};
  new Function('require','exports','process',ts.transpileModule(readFileSync('src/lib/wallet/config.ts','utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  }).outputText)(id=> {
    if(id==='server-only') return {};
    throw new Error(`Unexpected import ${id}`);
  },exports,{env});
  return exports.getWalletConfiguration();
}

test('Apple Wallet stays disabled even with certificate configuration until explicitly enabled',()=> {
  const env=Object.fromEntries(['APPLE_WALLET_PASS_TYPE_ID','APPLE_WALLET_TEAM_ID','APPLE_WALLET_WWDR_CERT_BASE64',
    'APPLE_WALLET_SIGNER_CERT_BASE64','APPLE_WALLET_SIGNER_KEY_BASE64'].map(k=>[k,'synthetic']));
  assert.equal(config(env).apple,false);
  assert.equal(config({...env,APPLE_WALLET_ENABLED:'true'}).apple,true);
  assert.match(readFileSync('src/lib/wallet/apple.ts','utf8'),/if \(!getWalletConfiguration\(\)\.apple\)[\s\S]+await import\("passkit-generator"\)/);
});
