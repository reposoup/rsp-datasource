const app = require('express')();
const path = require('path');
const fs = require('fs');
const openapi = require('express-openapi');
const cors = require('cors');
const DB = require("./dbhelper.js");

const THE_ZONE = "check";

// DB connection handler
let config = false;
let db = {};

function dbzone(zone){
    const dburl = config.db.url;
    if(db[zone]){
        return Promise.resolve(db[zone]);
    }else{
        return new Promise(done => {
            db[zone] = {};
            DB.make_db_queryhistory(dburl, zone)
            .then(queryhistory => {
                db[zone].queryhistory = queryhistory;
                return DB.make_db_queryrev(dburl, zone);
            }).then(queryrev => {
                db[zone].queryrev = queryrev;
                return DB.make_db_search(dburl, zone);
            }).then(search => {
                db[zone].search = search;
                return DB.make_db_getheads(dburl, zone);
            }).then(getheads => {
                db[zone].getheads = getheads;
                done(db[zone]);
            });
        });
    }
}

// Common result handlers
function unknown_service(req, res){
    res.status(404).json({err: "Unknown service"});
}

// Path handlers
const searchrevs = {
    get: function(req, res){
        // FIXME: Perhaps 500 or so??
        unknown_service(req, res);
    }
};

const fetchrevs = {
    post: function(req, res){
        // FIXME: Perhaps 500 or so??
        unknown_service(req, res);
    }
};

const mainhistory = {
    get: function(req, res){
        const count = req.query.count;
        const from = req.query.from;
        unknown_service(req, res);
    }
};

const heads = {
    get: function(req, res){
        dbzone(THE_ZONE).then(zone => zone.getheads("BOGUS"))
        .then(heads => {
            res.json({result: heads});
        });
    }
};

// Configure server
const openapi_args = {
    apiDoc: fs.readFileSync(path.resolve(__dirname, "api.json"), "utf8"),
    app: app,
    paths: [
        { 
            path: "/heads",
            module: heads  
        },
        { 
            path: "/searchrevs",
            module: searchrevs
        },
        { 
            path: "/fetchrevs",
            module: fetchrevs
        },
        {
            path: "/mainhistory",
            module: mainhistory 
        }
    ]
};

openapi.initialize(openapi_args);

module.exports = function(in_config){
    config = in_config; 
    return app;
};
