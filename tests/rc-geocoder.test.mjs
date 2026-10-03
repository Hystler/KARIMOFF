import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { isValidCoordinate } from '../src/lib/delivery/geo.ts';

function load(path, env, fetch) {
  const exports = {};
  new Function('require','exports','process','fetch',ts.transpileModule(readFileSync(path,'utf8'), {
    compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }
  }).outputText)(id=> {
    if(id==='server-only') return {};
    if(id==='./geo') return { isValidCoordinate };
    throw new Error(`Unexpected import ${id}`);
  },exports,{env},fetch);
  return exports;
}
const feature = () => ({ GeoObject: { Point:{pos:'38.055708 55.909221'}, metaDataProperty:{GeocoderMetaData:{
  kind:'house',precision:'exact',text:'Synthetic address',Address:{Components:[
    {kind:'country',name:'Россия'},{kind:'province',name:'Центральный федеральный округ'},
    {kind:'province',name:'Московская область'},{kind:'street',name:'Бахчиванджи'},{kind:'house',name:'5Б'}
  ]}
}}}});

test('Yandex server geocoder validates region hierarchy, uniqueness, coordinates and failure states', async () => {
  let features=[feature()]; let ok=true;
  const api=load('src/lib/delivery/yandex.ts',{YANDEX_GEOCODER_API_KEY:'mock-only'},async url=> {
    assert.equal(url.hostname,'geocode-maps.yandex.ru');
    return {ok,status:503,json:async()=>({response:{GeoObjectCollection:{featureMember:features}}})};
  });
  assert.deepEqual((await api.geocodeDeliveryAddress('Щёлково, Бахчиванджи, 5Б')).coordinates,[38.055708,55.909221]);
  features=[feature(),feature()];
  await assert.rejects(api.geocodeDeliveryAddress('Synthetic ambiguous address'),/AMBIGUOUS/);
  features=[feature()]; features[0].GeoObject.Point.pos='200 91';
  await assert.rejects(api.geocodeDeliveryAddress('Synthetic malformed address'),/AMBIGUOUS/);
  features=[feature()]; features[0].GeoObject.metaDataProperty.GeocoderMetaData.precision='near';
  await assert.rejects(api.geocodeDeliveryAddress('Synthetic imprecise address'),/AMBIGUOUS/);
  ok=false; await assert.rejects(api.geocodeDeliveryAddress('Synthetic address'),/UNAVAILABLE/);
  await assert.rejects(api.geocodeDeliveryAddress('x'),/AMBIGUOUS/);
});
