const MAX_DATA_SIZE = process.env.MAX_DATA_SIZE || '1mb';

require('dotenv').config();
const proxy = require('express-http-proxy');
const express = require('express');
const cors = require('cors');

const FormData = require('form-data');
const {URL, URLSearchParams} = require('url');
const fetch = require('node-fetch');
const Headers = fetch.Headers;
const { SignatureV4 } = require('@aws-sdk/signature-v4');
const { Sha256 } = require('@aws-crypto/sha256-js');

const app = express();
app.use(cors());

app.use('/proxy', proxy((req) => {
    console.log("/proxy called");

    const host = req.headers["target_host"];
    if (!host)
        throw "target_host not set";
    var location = new URL(host);
    return location.protocol + "//" + location.host;
}, {
    parseReqBody: false,
    proxyReqPathResolver: function(req) {
        const host = req.headers["target_host"];
        if (!host)
            throw "target_host not set";
        var location = new URL(host);
        return location.pathname + location.search + location.hash;
    },
    userResHeaderDecorator(headers, userReq, userRes, proxyReq, proxyRes) {
      headers['access-control-allow-origin'] = userReq.headers["origin"];
      return headers;
    }
}));

app.use(express.json({
    limit: MAX_DATA_SIZE
}));

app.post('/agent', async (req, res) => {
    console.log('/agent called');
    console.log("body=" + JSON.stringify(req.body));
    try{
        const host = req.headers["target_host"];
        const type = req.headers["target_type"];
        if (!host || !type)
            throw "target_host/type not set";

	    console.log("host=" + host);
	    console.log("type=" + type);
        let headers = make_headers(req.body.headers);
        let response;
        if (type == "get") {
            var input = {
                url: host,
                qs: req.body.qs,
                headers: headers,
                method: "GET",
                response_type: "raw"
            }
            response = await do_http(input);
        } else
        if (type == "post_json") {
            var input = {
                url: host,
                qs: req.body.qs,
                body: JSON.parse(req.body.body),
                headers: headers,
                method: "POST",
                response_type: "raw"
            };
            response = await do_http(input);
        } else
        if (type == "post_form-data") {
            var input = {
                url: host,
                qs: req.body.qs,
                params: req.body.params,
                headers: headers,
                method: "POST",
                content_type: "multipart/form-data",
                response_type: "raw"
            };
            response = await do_http(input);
        } else
        if (type == "post_x-www-form-urlencoded") {
            var input = {
                url: host,
                qs: req.body.qs,
                params: req.body.params,
                headers: headers,
                method: "POST",
                content_type: "application/x-www-form-urlencoded",
                response_type: "raw"
            };
            response = await do_http(input);
        } else {
            throw "target_type not invalid";
        }

        response.body.pipe(res);
    }catch(error){
        res.status(500);
        res.json({errorMessage: error.toString() });
    }
});

app.post('/aws', async (req, res) => {
    console.log('/aws called');
    console.log("body.params=" + JSON.stringify(req.body.params));
    try{
      var response = await fetchAwsRequest(req.body.params, req.body.cred);
      response.body.pipe(res);
    }catch(error){
      console.error(error);
        res.status(500);
        res.json({errorMessage: error.toString() });
    }
});

const port = Number(process.env.PORT) || 30080;
app.listen(port, () => {
    console.log('http PORT=' + port)
})


function make_headers(headers_json) {
    const headers = new Headers();

    if (headers_json) {
        Object.keys(headers_json).forEach(key => {
            if (key == 'target_host' || key == 'target_type')
                return;
            headers.set(key, headers_json[key]);
        });
    }

    return headers;
}

// input: url, method, headers, qs, body, params, response_type, content_type, token, api_key
async function do_http(input){
    const method = input.method ? input.method : "POST";
    const content_type = input.content_type ? input.content_type : "application/json";
    const response_type = input.response_type ? input.response_type : "json";
  
    const headers = new Headers();
    if( input.headers ){
      for( const key of Object.keys(input.headers))
        headers.append(key, input.headers[key]);
    }
  
    if( content_type != "multipart/form-data" )
      headers.append("Content-Type", content_type);
    if( input.token )
      headers.append("Authorization", "Bearer " + input.token);
    if( input.api_key )
      headers.append("x-api-key", input.api_key);
  
    let body;
    if( content_type == "application/json" ){
      body = JSON.stringify(input.body);
    }else if( content_type == "application/x-www-form-urlencoded"){
      body = new URLSearchParams(input.params);
    }else if( content_type == "multipart/form-data"){
      body = Object.entries(input.params).reduce((l, [k, v]) => { l.append(k, v); return l; }, new FormData());
    }else{
      body = input.body;
    }
  
    const params = new URLSearchParams(input.qs);
    var params_str = params.toString();
    var postfix = (params_str == "") ? "" : ((input.url.indexOf('?') >= 0) ? ('&' + params_str) : ('?' + params_str));
  
    return fetch(input.url + postfix, {
      method: method,
      body: body,
      headers: headers,
      cache: "no-store"
    })
    .then((response) => {
      if (!response.ok)
        throw new Error('status is not 200 (' + response.status + ")");

      if( response_type == "raw" )
        return response;
      else if( response_type == "json" )
        return response.json();
      else if( response_type == 'blob')
        return response.blob();
      else if( response_type == 'file'){
        const disposition = response.headers.get('Content-Disposition');
        let filename = "";
        if( disposition ){
          filename = disposition.split(/;(.+)/)[1].split(/=(.+)/)[1];
          if (filename.toLowerCase().startsWith("utf-8''"))
              filename = decodeURIComponent(filename.replace(/utf-8''/i, ''));
          else
              filename = filename.replace(/['"]/g, '');
        }
        return response.blob()
        .then(blob =>{
          return new File([blob], filename, { type: blob.type })      
        });
      }
      else if( response_type == 'binary')
        return response.arrayBuffer();
      else // response_type == "text"
        return response.text();
    });
}

// params = { host, method, canonicalUri, canonicalHeaders?, canonicalQueryString?, payload?, service, region, content_type }
// cred = { accessKeyId, secretAccessKey, sessionToken? }
async function fetchAwsRequest(params, cred) {
    var headers = {
      'host': params.host,
    };
    Object.assign(headers, params.canonicalHeaders);
  
    const signer = new SignatureV4({
      credentials: {
        accessKeyId: cred.accessKeyId,
        secretAccessKey: cred.secretAccessKey,
        sessionToken: cred.sessionToken
      },
      region: params.region,
      service: params.service,
      sha256: Sha256
    });
  
    const signedRequest = await signer.sign({
      method: params.method,
      headers: headers,
      hostname: params.host,
      path: params.canonicalUri,
      query: params.canonicalQuerystring,
      protocol: 'https:',
      body: params.payload,
    });
    Object.assign(headers, signedRequest.headers);
 
    var input = {
      url: "https://" + params.host + params.canonicalUri, 
      method: params.method,
      headers: headers,
      response_type: "raw",
      content_type: params.content_type,
      body: params.payload
    }
    var result = await do_http(input);
    console.log("fetchAws OK");
  
    return result;
}
