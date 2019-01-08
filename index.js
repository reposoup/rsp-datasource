const express = require("express");
const fs = require('fs');
const openapi = require('express-openapi');
const cors = require('cors');
const bodyparser = require("body-parser");
const Yaml = require("js-yaml");
const config = Yaml.safeLoad(fs.readFileSync(__dirname + "/config.yml", "utf8"));
const ServiceReader = require("./service_reader.js");
const ServiceWriter = require("./service_writer.js");

const app = express();
//const app = ServiceReader(config);

// Load configuration, secrets
const config_port = process.env.PORT ? process.env.PORT : 9999;

// Err
function something_wrong(err, req, res, next){
    if(res.headersSent){
        return next(err);
    }
    res.status(500);
    res.json(err);
}

// Configure server

const cors_options = {
    origin: "*", // FIXME: Arrange this
    methods: "GET"
};

app.use(cors(cors_options));
app.use(bodyparser.json());
app.use("/read", ServiceReader(config));
app.use("/write", ServiceWriter(config));

app.disable("etag"); // As an API server, it's waste of time
console.log("Listening at", config_port);
app.use(something_wrong);
app.listen(config_port);

console.log("Starting...", config);
