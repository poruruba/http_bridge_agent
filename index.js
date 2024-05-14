const MAX_DATA_SIZE = process.env.MAX_DATA_SIZE || '1mb';

require('dotenv').config();
const proxy = require('express-http-proxy');
const express = require('express');
const cors = require('cors');

const FormData = require('form-data');
const {URL, URLSearchParams} = require('url');
const fetch = require('node-fetch');
const Headers = fetch.Headers;

const app = express();
app.use(cors());
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
            response = await do_get(host, req.body.qs, headers)
        } else
        if (type == "post_json") {
            response = await do_post(host, req.body.qs, req.body.body, headers);
        } else
        if (type == "post_form-data") {
            response = await do_post_formdata(host, req.body.qs, req.body.params, headers);
        } else
        if (type == "post_x-www-form-urlencoded") {
            response = await do_post_urlencoded(host, req.body.qs, req.body.params, headers);
        } else {
            throw "target_type not invalid";
        }

        response.body.pipe(res);
    }catch(error){
        res.status(500);
        res.json({errorMessage: error.toString() });
    }
});

app.use('/', proxy((req) => {
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
//    },
//    userResHeaderDecorator(headers, userReq, userRes, proxyReq, proxyRes) {
//      headers['access-control-allow-origin'] = userReq.headers["origin"];
//      return headers;
    }
}));

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

async function do_get(url, qs, headers) {
    var params = new URLSearchParams(qs).toString();
    var searchs = new URL(url).searchParams.toString();
    var postfix = params ? (searchs ? '&' + params : '?' + params) : "";
    return fetch(url + postfix, {
        method: 'GET',
        headers: headers
    });
}

async function do_post_formdata(url, qs, params, headers) {
    var params = new URLSearchParams(qs).toString();
    var searchs = new URL(url).searchParams.toString();
    var postfix = params ? (searchs ? '&' + params : '?' + params) : "";
    const body = Object.entries(params).reduce((l, [k, v]) => {
        l.append(k, v);
        return l;
    }, new FormData());

    return fetch(url + postfix, {
        method: 'POST',
        body: body,
        headers: headers
    });
}

async function do_post_urlencoded(url, qs, params, headers) {
    var _params = new URLSearchParams(qs).toString();
    var searchs = new URL(url).searchParams.toString();
    var postfix = _params ? (searchs ? '&' + _params : '?' + _params) : "";
    headers.set('Content-Type', 'application/x-www-form-urlencoded');
    const body = new URLSearchParams(params);

    return fetch(url + postfix, {
        method: 'POST',
        body: body,
        headers: headers
    });
}

async function do_post(url, qs, body, headers) {
    var params = new URLSearchParams(qs).toString();
    var searchs = new URL(url).searchParams.toString();
    var postfix = params ? (searchs ? '&' + params : '?' + params) : "";
    headers.set('Content-Type', 'application/json');

    return fetch(url + postfix, {
        method: 'POST',
        body: JSON.stringify(body),
        headers: headers
    });
}
