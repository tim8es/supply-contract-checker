import test from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_KEY,loadModelSettings,saveModelSettings,clearModelSettings } from '../src/model-settings.mjs';

const fakeStorage=()=> {
 const entries=new Map();
 return {
  getItem:key=>entries.get(key)??null,
  setItem:(key,value)=>entries.set(key,value),
  removeItem:key=>entries.delete(key)
 };
};
test('endpoint and model persist locally while API key is not stored by default',()=>{
 const storage=fakeStorage();
 assert.equal(saveModelSettings(storage,{endpoint:'https://api.example/v1/chat/completions',model:'model-a',apiKey:'SENSITIVE'}),true);
 const raw=storage.getItem(SETTINGS_KEY);
 assert.ok(raw.includes('model-a'));
 assert.ok(!raw.includes('SENSITIVE'));
 assert.deepEqual(loadModelSettings(storage),{
  endpoint:'https://api.example/v1/chat/completions',model:'model-a',rememberKey:false,apiKey:''
 });
});
test('explicit remember-key opt-in persists key and can be revoked',()=>{
 const storage=fakeStorage();
 saveModelSettings(storage,{endpoint:'https://api.example/v1/chat/completions',model:'model-a',rememberKey:true,apiKey:'CONSENTED_KEY'});
 assert.equal(loadModelSettings(storage).apiKey,'CONSENTED_KEY');
 saveModelSettings(storage,{endpoint:'https://api.example/v1/chat/completions',model:'model-a',rememberKey:false,apiKey:'CONSENTED_KEY'});
 assert.equal(loadModelSettings(storage).apiKey,'');
 assert.ok(!storage.getItem(SETTINGS_KEY).includes('CONSENTED_KEY'));
 assert.equal(clearModelSettings(storage),true);
 assert.equal(storage.getItem(SETTINGS_KEY),null);
});
test('malformed or blocked local storage does not break app settings',()=>{
 const storage=fakeStorage();
 storage.setItem(SETTINGS_KEY,'{bad');
 assert.equal(loadModelSettings(storage).endpoint,'');
 const blocked={
  getItem(){throw Error('blocked');},
  setItem(){throw Error('blocked');},
  removeItem(){throw Error('blocked');}
 };
 assert.equal(loadModelSettings(blocked).apiKey,'');
 assert.equal(saveModelSettings(blocked,{model:'no persistence'}),false);
 assert.equal(clearModelSettings(blocked),false);
});
test('malformed saved settings cannot trick app into restoring an opted-out key',()=>{
 const storage=fakeStorage();
 storage.setItem(SETTINGS_KEY,JSON.stringify({endpoint:42,model:'yes',apiKey:'LEAK',rememberKey:false}));
 assert.equal(loadModelSettings(storage).endpoint,'');
 assert.equal(loadModelSettings(storage).apiKey,'');
});
