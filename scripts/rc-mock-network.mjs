// Only mounted by verify-release-browser.mjs into the isolated local container.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return originalFetch(input, init);
  if (url.hostname === 'geocode-maps.yandex.ru') return Response.json({response:{GeoObjectCollection:{featureMember:[{
    GeoObject:{Point:{pos:'38.055708 55.909221'},metaDataProperty:{GeocoderMetaData:{kind:'house',precision:'exact',
      text:'Synthetic RC address',Address:{formatted:'Synthetic RC address',Components:[
        {kind:'country',name:'Россия'},{kind:'province',name:'Московская область'},
        {kind:'street',name:'Бахчиванджи'},{kind:'house',name:'5Б'}
      ]}}}}
  }]}}});
  if (url.hostname === 'suggest-maps.yandex.ru') return Response.json({results:[{
    title:{text:'Бахчиванджи, 5Б'},uri:'synthetic:rc',address:{formatted_address:'Бахчиванджи, 5Б',component:[
      {kind:['STREET'],name:'Бахчиванджи'},{kind:['HOUSE'],name:'5Б'}
    ]}
  }]});
  // No YooKassa, Telegram, MAX, Evotor or other external request can leave the fixture.
  throw new Error('RC_LOCAL_EXTERNAL_NETWORK_BLOCKED');
};
