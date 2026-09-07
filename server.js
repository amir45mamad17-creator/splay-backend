require("dotenv").config();

const express = require("express");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
    res.json({
        success: true,
        app: "SPlay Backend",
        message: "SPlay backend is running"
    });
});

app.get("/health", (req, res) => {
    res.json({
        success: true,
        status: "OK"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`SPlay Backend running on port ${PORT}`);
});
