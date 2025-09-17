const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const answerRoute = require("./routes/answer");
const apiResRoute = require("./routes/reservationApi");
const aiCallbackRoute = require("./routes/aiCallback");

function createServer() {
    const app = express();
    app.use(bodyParser.json());

    const allowedOrigins = [
        "http://172.19.0.1:8000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ];
    app.use(
        cors({
            origin: function (origin, callback) {
                if (!origin) return callback(null, true);
                if (allowedOrigins.includes(origin))
                    return callback(null, true);
                return callback(new Error("Not allowed by CORS"), false);
            },
            credentials: true,
        })
    );

    app.use("/", answerRoute);
    app.use("/", apiResRoute);
    app.use("/", aiCallbackRoute);

    return app;
}

module.exports = { createServer };
