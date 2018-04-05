// providing search functions for the Pitch Perfect app.
const express = require('express');
const app = express();

const request = require('request-promise'); // HTTP request with promise
const metascraper = require('metascraper');
const twit = require('twit'); // For the Twitter API
const jsonfile = require('jsonfile');
var cors = require('cors');
// var path = require('path');

// app.use(express.static(__dirname + '/public')); // set the static files location /public/img will be for users
app.use(cors());

require("babel-polyfill");
const outputFile = './tmp/data.json';
const testResult = require('./test.json');

const port = process.env.PORT || 8097; 

//----------------------------------------------------------------------------------------------------------//
// Create twitter object..
//----------------------------------------------------------------------------------------------------------//
const twitter = new twit({
    consumer_key:         'N8MClTWEPzoinTCTmWPzKrdiD',
    consumer_secret:      '4DzgKrQAyyijtKBSLqWJ3IfpjXT3yc0YRVpNvNvjChhv5MxB7r',
    access_token:         '125362178-L8dZvLuZY4lgdBqA8Ou7YIefaJdk6dGQpEatYNRC',
    access_token_secret:  'kSuopl55nhXnEQSxYw0Fugb2C3ijrTtZlFLqdAzgToMQp'
    // timeout_ms:           60*1000,  // optional HTTP request timeout to apply to all requests.
});
getAppLimitsTwitter();

var decKey = '';
var firebase = require('firebase-admin');
var serverAccount = require('./firebase.json');
firebase.initializeApp({
    credential: firebase.credential.cert(serverAccount),
    databaseURL: "https://pitch-perfect-app-144.firebaseio.com",
});

firebase.database().ref('key').on('value', function(snapshot) {
    decKey = snapshot.val();
    console.log('Decrypt key', decKey);
});

var Crypt = require('cryptr');
var authCheck = function(req, res, next) {
    var auth = req.get('Authorization');
    if(auth) {
        var crypt = new Crypt(decKey);
        try {
            var dec = crypt.decrypt(auth);
            console.log('DECRYPT', dec);
            if(dec == 'VALID') {
                next();
            } else {
                console.log('Failed Checking');
                res.send('Server working well');
            }
        } catch(err) {
            console.log('Error Checking');
            res.send('Server working well');
        }
    } else {
        console.log('No Auth for Checking');
        res.send('Server working well');
    }
}

app.use(authCheck);

//----------------------------------------------------------------------------------------------------------//
// Search Query
//----------------------------------------------------------------------------------------------------------//
function initialSearchQuery(query, market, time, offset, count, callback) {
    const options = {
        uri: 'https://api.cognitive.microsoft.com/bing/v7.0/news/search',
        method: 'GET',
        qs: { q: query, mkt: market, freshness: time, count: count, offset: offset },
        headers: {
            'Content-Type':   'application/json',
            'Ocp-Apim-Subscription-Key':   '984558dd2e854536ad453b96579a097c',
        },
        json: true
    };

    console.log('\n--> Options\n', options);

    request(options).then(bingResults => {
        console.log('\n---> Bing Search Result Estimated : ' + bingResults.totalEstimatedMatches);
        return getArticleMetaData(bingResults);
    }).then(result =>{
        callback(result);
    }).catch(error => {
        console.log('\n---> Bing Search error\n', error.message);
        callback(null, error);
    });
}

async function getArticleMetaData(bingResults) {
    
    bingResults = bingResults.value;
    let filteredResults = [];
    console.log('\n---> Result length : ' + bingResults.length);

    //let filteredResults = [];
    for (let i = 0; i < bingResults.length; i++) {

        console.log('\n -> Point : ' + (i + 1));
        console.log(' --> Article \n ', bingResults[i]);
        const count = `Article ${i + 1}/${bingResults.length}:`;

        // Set the general data before scraping anything
        const result = {};
        result.title = bingResults[i].name;
        result.date = bingResults[i].datePublished;
        result.description = bingResults[i].description;
        if (bingResults[i].image) {
            result.image = bingResults[i].image.thumbnail.contentUrl;
        } else {
            result.image = null;
        }

        console.log(' ------> Step 1 finished!');

        result.url = stripBingUrl(bingResults[i].url);
        result.domain = extractRootDomain(result.url);
        result.category = bingResults[i].category || null;
        result.publisher = bingResults[i].provider[0].name || null;
        result.meta = {};
        result.meta.state = false;

        console.log(' ------> Step 2 finished!');
        const meta = await metascraper.scrapeUrl(bingResults[i].url);

        if (meta.author) {
            const nameArray = meta.author.split(' ');
            if (nameArray.length === 2) {
                console.log(`${count} Author appears to be valid :)`);

                meta.state = true;
                meta.title = result.title;
                meta.date = result.date;
                meta.description = result.description;
                meta.image = meta.image || result.image;
                meta.url = result.url;
                meta.domain = result.domain;
                meta.category = result.category;
                meta.publisher = result.publisher || meta.publisher;

                // Correct the author object
                meta.author = {};
                meta.author.state = true;
                meta.author.first_name = nameArray[0].toLowerCase();
                meta.author.last_name = nameArray[1].toLowerCase();

                console.log(`${count} Searching for a twitter account...`);
                meta.twitter = await findAuthorsTwitter(meta.author, meta.publisher);
                console.log(`${count} Searching for an email address...`);
                meta.email = await findEmail(meta.author, meta.domain);

                // Attach as meta to the article result
                //bingResults[i].meta = meta;
                result.meta = meta;
                console.log(result);
            } else {
                console.log(`${count} Author name not valid :( skipping...`);
            }
        } else {
            console.log(`${count} Author not found... skipping...`);
        }

        filteredResults.push(result);
        console.log('---------------');
    }

    return filteredResults;
}

///// TWITTER HELPERS /////

async function getAppLimitsTwitter() {
    //application/rate_limit_status
    const limits = await twitter.get('application/rate_limit_status');
    console.log("Twitter Limit \n", limits.data.resources.application['/application/rate_limit_status']);
    // const result = await twitter.post('statuses/show?id=981521760687333378');
    var params = {
        "event": {
            "type": "message_create",
            "message_create": {
                "target": {
                    "recipient_id": "981521760687333378"
                },
                "message_data": {
                    "text": "Hello World!"
                }
            }
        }
    };
    const result = await twitter.post('direct_messages/events/new', params);

    console.log('Email', result.data);
    //debugger;
}

async function findAuthorsTwitter(author, publisher) {
    author = author.first_name + ' ' + author.last_name;
    const twitterObject = {};
    twitterObject.state = false;
    let possibleMatches = [];
    let firstPass = await twitter.get('users/search', { q: `"${author}"` });
    firstPass = firstPass.data;

    for (let i = 0; i < firstPass.length; i++) {
        if (stringContainsPublisher(firstPass[i].description, publisher)) {
            // Potential match found
            console.log('Twitter first pass: Publisher found in description');
            possibleMatches = possibleMatches.concat(firstPass[i]);
        } else if (entitiesContainsPublisher(firstPass[i], publisher)) {
            console.log('First pass: Publisher found in entities');
            possibleMatches = possibleMatches.concat(firstPass[i]);
        }
    }

    // If no matches found, try searching with Author and Publisher
    if (possibleMatches.length === 0) {
        let secondPass = await twitter.get('users/search', { q: `"${author}" "${publisher}"` });
        secondPass = secondPass.data;

        for (let i = 0; i < secondPass.length; i++) {
            if (secondPass[i].name.toLowerCase() === author) {
                console.log('Second pass: Author name matches result');
                possibleMatches = possibleMatches.concat(secondPass[i]);
            }
        }
    }

    // Return the results
    if (possibleMatches.length) {
        return twitterSanitise(possibleMatches[0]);
    } else {
        return twitterObject;
    }
}

function twitterSanitise(match) {
    // Take the returned JSON from twitter and clean
    const sanitised = {};
    sanitised.state = true;
    sanitised.id = match.id;
    sanitised.id_str = match.id_str;
    sanitised.name = match.name;
    sanitised.screen_name = match.screen_name;
    sanitised.location = match.location;
    sanitised.description = match.description;
    sanitised.url = match.url;
    sanitised.protected = match.protected;
    sanitised.followers_count = match.followers_count;
    sanitised.friends_count = match.friends_count;
    sanitised.listed_count = match.listed_count;
    sanitised.created_at = match.created_at;
    sanitised.favourites_count = match.favourites_count;
    sanitised.utc_offset = match.utc_offset;
    sanitised.time_zone = match.time_zone;
    sanitised.geo_enabled = match.geo_enabled;
    sanitised.verified = match.verified;
    sanitised.statuses_count = match.statuses_count;
    sanitised.lang = match.lang;
    return sanitised;
}

function entitiesContainsPublisher(account, publisher) {
    let publisherFound = false;
    publisher = publisher.toLowerCase().split('.');
    const urlEntities = account.entities.description.urls;
    if (urlEntities.length) {
        for (let i = 0; i < urlEntities.length; i++) {
            if (urlEntities[i].display_url.toLowerCase().includes(publisher[0]))
                publisherFound = true;
        }
    }
    return publisherFound;
}

function stringContainsPublisher(string, publisher) {
    string = string.toLowerCase();
    publisher = publisher.toLowerCase().split('.');
    const publisher2 = publisher[0].split(' ');
    if (string.includes(publisher[0])) {
        return true;
    } else if (string.includes(publisher2[0])) {
        // Just in case the publisher has a load of extra words
        return true;
    } else {
        return false;
    }
}

///// EMAIL HELPERS /////

async function findEmail(author, domain) {
    const first_name = author.first_name;
    const last_name = author.last_name;
    const emailObject = {};
    emailObject.state = false;
    console.log(' ---> Find Email name : ' + first_name + ' + ' + last_name);
    const options = {
        method: 'GET',
        uri: 'https://api.hunter.io/v2/email-finder',
        qs: {
            domain,
            first_name,
            last_name,
            api_key: '7083c9eda2eb7c830e713dc4a0b88f830aef5bfc'
        },
        json: true
    };
    const response = await request(options).catch(err => {
        return {
            data: {
                email: null,
            }
        };
    });

    console.log('Email hunter api result \n', response);
    if (response.data.email !== null) {
        return emailSanitise(response.data);
    } else {
        return emailObject;
    }
    // TODO: Need to try and validate the email
    // TODO: Need to check for errors
}

function emailSanitise(match) {
    // Take the returned JSON from hunter.io and clean
    const sanitised = {};
    sanitised.state = true;
    sanitised.address = match.email;
    sanitised.score = match.score;
    return sanitised;
}

// Take the Bing Search URL and return the real URL
function stripBingUrl(url) {
    const articleUrl = url;
    // const articleUrl = url.split('&r=')[1].split('&p=')[0];
    return (decodeURIComponent(articleUrl));
}

// Take a URL and return the root domain
function extractRootDomain(url) {
    let domain = extractHostname(url);
    const splitArr = domain.split('.');
    const arrLen = splitArr.length;
    // Extract root domain (if there's' a subdomain)
    if (arrLen > 2) {
        domain = splitArr[arrLen - 2] + '.' + splitArr[arrLen - 1];
        //check to see if it's using a Country Code Top Level Domain (ccTLD) (i.e. ".me.uk")
        if (splitArr[arrLen - 1].length === 2 && splitArr[arrLen - 1].length === 2) {
            //this is using a ccTLD
            domain = splitArr[arrLen - 3] + '.' + domain;
        }
    }
    return domain;
}

// Take a URL and return the host name
function extractHostname(url) {
    let hostname;
    //find & remove protocol (http, ftp, etc.) and get hostname
    if (url.indexOf('://') > -1) {
        hostname = url.split('/')[2];
    } else {
        hostname = url.split('/')[0];
    }
    //find & remove port number
    hostname = hostname.split(':')[0];
    //find & remove "?"
    hostname = hostname.split('?')[0];
    return hostname;
}

// Express Routing
app.get('/search.json', function(req, res) {
    let searchParams = {time: req.query.t, boundary: req.query.l, offset: req.query.step * 10, count: 10};
    let tags = req.query.tag;
    console.log(tags);
    // Trigger the search
    let query = '';
    var testQuery = false;
    if(!tag) {
        query = '""';
    } else {
        if(tags.isArray) {
            for(let itemKey in tags) {
                query += '"' + tags[itemKey] + '" ';
            }
        } else {
            query = '"' + tags + '"';
            if  (tags == 'test') {
                testQuery = true;
            }
        }
    }

    // console.log(query,'<<<<< Simons code');
    if(testQuery == false) {
        initialSearchQuery(query, searchParams.boundary, searchParams.time, searchParams.offset, searchParams.count, function (resultContent, error) {
            if(!error) {
                var responseContent = {
                    searchDetails: {
                        searchParams: searchParams,
                        tags: tags
                    },
                    results: resultContent
                };
                res.json(responseContent);
            } else {
                res.statusCode = 401;
                res.send('Error');
            }
        });
    } else {
        let responseContentTest = testResult;
        res.json(responseContentTest);
    }
});

// Express Routing
app.post('/twt_post', function(req, res) {
    console.log(req.query);
    res.send('200');
});

app.get('*', function(req, res) {
    console.log('Not matched url : ' + req.url);
    res.send('<h1>Server working well</h1>');
});


app.listen(port, () => console.log('App listening on port', port))