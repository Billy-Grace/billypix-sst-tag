// Libraries needed
const encodeUriComponent = require('encodeUriComponent');
const generateRandom = require('generateRandom');
const getCookieValues = require('getCookieValues');
const getAllEventData = require('getAllEventData');
const log = require('logToConsole');
const makeString = require('makeString');
const sendHttpGet = require('sendHttpGet');
const setCookie = require('setCookie');
const getRequestHeader = require('getRequestHeader');
const getTimestamp = require('getTimestamp'); // getTimestamp() == Date.now() in js
const getTimestampMillis = require('getTimestampMillis');
const Math = require('Math');
const JSON = require('JSON');
const Object = require('Object');
const createRegex = require('createRegex');
const parseUrl = require('parseUrl');

// Mapping of GA4 events to names billy uses
const mappedEventNames = {
  page_view: 'pageload',
  'gtm.dom': 'pageload',
  add_payment_info: 'payment_info_submitted',
  add_to_cart: 'add_to_cart',
  begin_checkout: 'checkout_started',
  search: 'search_submitted',
  
  // Fallback for events coming from wp plugin with a different name
  'gtm4wp.addProductToCartEEC': 'add_to_cart',
  'gtm4wp.productClickEEC': 'page_viewed',
  'gtm4wp.checkoutOptionEEC': 'checkout_started',
  'gtm4wp.checkoutStepEEC': 'payment_info_submitted',
  'gtm4wp.orderCompletedEEC': 'checkout_completed'
};

// Options to always use for cookiets
const cookieOptions = {
  domain: 'auto',                   // Grabs the TLD from this request
  path: '/',                        // For all paths on this domain
  samesite: data.cookieSameSite,    // 'none' is third party, this is still first
  secure: true,                     // Only https
  'max-age': 3600 * 24 * 365 * 2,   // 2 years
  HttpOnly: !!data.cookieHttpOnly   // Double negation because the true value not string 'true'
};

// Other constants needed
const USER_ID_COOKIE = '__cookie_uid';
const GTMS_ID_COOKIE = '__bg_utm';
const VERSION = '0.5.0';
const VALID_PURCHASE_NAMES = ['purchase', 'order_completed'];

// Grab all the data being passed from the sst client
const allEvents = getAllEventData();

// Debugging
if (data.isDebug){
  log('Tag Configuration: ', data);
  log('incomingevents: ', getAllEventData());
  log('getCookieValues: ', getCookieValues(USER_ID_COOKIE));
}

// Similar to pixel js bundle
function getGuid() {
  const uidRegex = createRegex('[x]', 'g');

  return VERSION + '-xxxxxxxx-'.replace(uidRegex, function() {
    let r = generateRandom(0, 1000);
    return r.toString(36);
  }) + (1 * getTimestamp()).toString(36);
}

// The user ID is taken from a cookie, if present. If it's not present, a new ID
// is randomly generated and stored for later use.
function getUserId() {
  
  // Check the existence for both cookie headers or in event data, if not we need to generate one
  const userId = getCookieValues(USER_ID_COOKIE)[0] || allEvents[USER_ID_COOKIE] || getGuid();
  
  // The setCookie API adds a value to the 'cookie' header on the response.
  setCookie(USER_ID_COOKIE, makeString(userId), cookieOptions);

  return userId;
}


// Easily add params to the url
const mapEventName = function(inheritEventName, eventName) {
  // Use the custom name defined for this tag 
  if (!inheritEventName) {
    return data.customEventName;
  }
  
  // If there is no custom mapping from GA4 to billy, we use the incoming name
  if (!mappedEventNames[eventName]){
     return eventName;
  }
 
  // Map the GA4 event to a similar billy event
  return mappedEventNames[eventName];
};


function isPresent(variable) {
  return typeof(variable) !== 'undefined' && variable !== null && variable !== '';
}


// Basically a floadlight, that checks if the current urls has utm query params we search for and;
// - If there are query params matching the utmArray found, then save then all under cookie '__BillyPix_utm'
// - If no query from utmArray is found, then do nothing as existing values are 'session' based
function getAndUpdateGtmBgParamCookies() {
  const utmArray = [
    'utm_source', 'utm_medium', 'utm_term', 'utm_content', 'utm_campaign', 
    'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    'bg_source', 'bg_source_id', 'bg_kw', 'bg_campaign', 'bg_aid_k', 'bg_aid_v'
  ];

  // We want to write utms to cookie storage, if any utm is matched from the current url (aka ad click)
  var save = {};
  var newUtms = false;

  // Parse all query params at once into an object
  // e.g. vazkir.com?id=57&name=king -> {id: 57, name: 'king'} 
  const url = allEvents.page_location || getRequestHeader('referer');
  const parsedParams = parseUrl(url).searchParams;

  for (var i = 0, l = utmArray.length; i < l; i++) {
    const utmKey = utmArray[i];

    // e.g. vazkir.com?utm_source=google.com -> utmKey:utm_source
    // Basically a null, undefined, '' check for the value of the utm key/name we matched
    if (isPresent(parsedParams[utmKey])){
      save[utmArray[i]] = parsedParams[utmKey];
      newUtms = true; // If any new one exists, we want to starts saving
    }
  }
  
  // Only write to cookie if there are any query params, don't need to purger existing ones because 'session' based
  if (newUtms){

    // Saves all the incoming utm values into the cookie storage as 1 string, meaning this also
    // e.g {utm_source:'vazkir.com', utm_medium:'phone'} -> '{'utm_source':'vazkir.com','utm_medium':'phone'}'
    // The setCookie API adds a value to the 'cookie' header on the response.
    setCookie(GTMS_ID_COOKIE, JSON.stringify(save), cookieOptions);
   
     // Return the dict with the latest params
     return save;
  }else{
    
    // Grab existing utm cookie storage if existent
    const cookieUtms = getCookieValues(GTMS_ID_COOKIE);
    
    // If no entry exists, we don't need to decode the json so return an empty object
    if (!cookieUtms[0]) {
      return {};
    }
    
    // Lets try to parse the stored values for the cookies
    return JSON.parse(cookieUtms[0]) || {};
  }
}


// Extra custom event data being send in the event
function mapCustomEventData(eventName, allEventData, data){
  let customEventData = {};

  // Purchase, order completed etc, lowercased check
  if (eventName && VALID_PURCHASE_NAMES.indexOf(eventName.toLowerCase()) >= 0){
    
    if (allEventData.value || allEventData.transaction_id){
      if (allEventData.price) customEventData.value = allEventData.price;
      if (allEventData.value) customEventData.value = allEventData.value;
      if (allEventData.transaction_id) customEventData.transaction_id = allEventData.transaction_id; 
      if (allEventData.currency) customEventData.currency = allEventData.currency;
    }
    
     // If any items (products) are included to this event
    else if (allEventData.items && allEventData.items[0]) {
      customEventData.content_type = 'product';
      
      // If there is only 1 product to add, so no second entry exists
      if (!allEventData.items[1]) {
        if (allEventData.items[0].item_name) customEventData.content_name = allEventData.items[0].item_name;
        if (allEventData.items[0].item_category) customEventData.content_category = allEventData.items[0].item_category;
        if (allEventData.items[0].quantity) customEventData.quantity = allEventData.items[0].quantity;
        if (allEventData.items[0].currency) customEventData.currency = allEventData.items[0].currency;
        if (allEventData.items[0].price) customEventData.value = allEventData.items[0].price;
        if (allEventData.transaction_id) customEventData.transaction_id = allEventData.transaction_id;
        
        // Headless shopify suport
        if (allEventData.items[0].order_id) customEventData.oid = allEventData.items[0].order_id;
        if (allEventData.items[0].checkout_token) customEventData.cot = allEventData.items[0].checkout_token;

        // Order value to use for this order
        if (allEventData.items[0].value) {
          customEventData.value = allEventData.items[0].value;
        }
        // GA4 can define value outside of item list
        else if (allEventData.value){
          customEventData.value = allEventData.value;
        }
        // Caluclate the order value ourselves
        else if (allEventData.items[0].price && allEventData.items[0].quantity){
          customEventData.value = allEventData.items[0].quantity * allEventData.items[0].price;
        }
        // Assuming a quantity of 1, as no quantity given 
        else if (allEventData.items[0].price){
          customEventData.value = allEventData.items[0].value;
        }          
      }
    }
  }

  // If any of the values are set, then override anything we currently have
  if (data.transaction_id) customEventData.transaction_id = data.transaction_id;
  if (data.value) customEventData.value = data.value;
  if (data.currency) customEventData.currency = data.currency;
  
  // Used for de-duplication and is send as event data
  if (allEventData.event_id) customEventData.event_id = allEventData.event_id;
  
  // Just an empty string so no object parsing will happen on receival
  if (Object.keys(customEventData).length === 0){
     return '';
  }
  
  // Prepare data to be send out
  return JSON.stringify(customEventData);
}

// Updates and grabs the right params we need to send to the bg backend
const adParams = getAndUpdateGtmBgParamCookies();

// Optionally overridable to another name
const eventName = mapEventName(data.inheritEventName, allEvents.event_name);

// Grab all the event data we need
const eventData = mapCustomEventData(eventName, allEvents, data);

if (data.isDebug){
  log('eventName', eventName);
  log('eventData', eventData);
  log('referer', allEvents.page_referrer || getRequestHeader('referer'));
}

const trackingData = {
  id:         data.trackingID, // Website ID
  uid:        getUserId(), // User ID
  session_id: allEvents.session_id || allEvents.ga_session_id, // Custom session id or ga's one
  ev:         eventName, // Event triggered
  ed:         eventData, // Custom Event data (e.g. purchase event information)
  v:          VERSION, // Pixel code version
  ts:         Math.round(getTimestampMillis() / 1000), // Timestamp when event was triggered
  sr:         allEvents.screen_resolution || 'unknown', // Screen resolution
  dt:         allEvents.page_title || 'unknown', // Document title
  
  // The following parameters are unused and unavailable from GA4 by default, so they are skipped:
  de:           '', // Document encoding
  vp:           '', // Viewport size
  cd:           '', // Color depth
  bn:           '', // Browser name and version number
  md:           '', // Is a mobile device?
  tz:           '', // Timezone
    
  // Extra server side params
  ip_override:  allEvents.ip_override || '', // Extra server-side parameter for IP override
  tt:           'web_sst',                   // Tracking type: So where it happened
  event_id:     '',                          // Field not used, as this is set in the event data (ed)

  // UTM Query params:
  utm_source:           adParams.utm_source || '',
  utm_medium:           adParams.utm_medium || '',
  utm_term:             adParams.utm_term || '',
  utm_content:          adParams.utm_content || '',
  utm_campaign:         adParams.utm_campaign || '',
  utm_source_platform:  adParams.utm_source_platform || '',
  utm_creative_format:  adParams.utm_creative_format || '',
  utm_marketing_tactic: adParams.utm_marketing_tactic || '',

  // BG Query params:
  bg_source:    adParams.bg_source || '',
  bg_source_id: adParams.bg_source_id || '',
  bg_kw:        adParams.bg_kw || '',
  bg_campaign:  adParams.bg_campaign || '',
  bg_aid_k:     adParams.bg_aid_k || '',
  
  // Longest params that are more error prone
  dl:         allEvents.page_location || getRequestHeader('origin'),   // Document location
  rl:         allEvents.page_referrer || getRequestHeader('referer'),  // Referrer location
  ua:         allEvents.user_agent || 'unknown',                       // User agent
};


function buildParams(allParamsObj) {
  let paramsList = [];
  
  // Add them all to an array while encoded for url passing
  Object.keys(allParamsObj).forEach(function(key,index) {
    const value = allParamsObj[key];
    if (typeof(value) !== 'undefined' && value !== null && value !== ''){
       paramsList.push(key + '=' + encodeUriComponent(value.toString()));
    }else{
       paramsList.push(key + '=');
    }
   });
    // Return the chained string to be used in the url
  return paramsList.join('&');
}



// The event name is taken from either the tag's configuration or from the
// event. Configuration data comes into the sandboxed code as a predefined
const endpoint = data.useStaging ? 'https://staging.b.billypx.com' : 'https://b.billypx.com';
const paramString = buildParams(trackingData);

const backendGetUrl = endpoint + '?' + paramString;

if (data.isDebug){
  log('backendGetUrl: ', backendGetUrl);
}


// The sendHttpGet API takes a URL and returns a promise that resolves with the
// result once the request completes. You must call data.gtmOnSuccess() or
// data.gtmOnFailure() so that the container knows when the tag has finished
// executing.
sendHttpGet(backendGetUrl).then((result) => {
  if (result.statusCode >= 200 && result.statusCode < 300) {
    data.gtmOnSuccess();
  } else {
    data.gtmOnFailure();
  }
});