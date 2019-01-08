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
            DB.w_make_db_setdtag(dburl, zone)
            .then(setdtag => {
                db[zone].setdtag = setdtag
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
const settag = {
    post: function(req, res){
        const reposname = req.query.repos;
        const ident = req.query.ident;
        const obj = req.body;
        const revid_replace = req.query.tagrev_replace ? req.query.tagrev_replace : false;
        dbzone(THE_ZONE).then(zone => zone.setdtag(reposname, ident, revid_replace, obj))
        .then(obj => {
            res.json({result: obj});
        }).catch(e => {
            console.log("Err", e);
            res.status(500).json({error: e});
        });

    }
};

// Configure server
const openapi_args = {
    apiDoc: fs.readFileSync(path.resolve(__dirname, "api.json"), "utf8"),
    app: app,
    paths: [
        {
            path: "/settag",
            module: settag 
        }
    ]
};

openapi.initialize(openapi_args);

module.exports = function(in_config){
    config = in_config; 
    return app;
};
