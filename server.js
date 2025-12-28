require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


// Password check route
app.post("/api/check-pass", (req, res) => {
  const { password } = req.body;
  if(password === "arzan") return res.json({ success: true });
  else return res.json({ success: false });
});


// ------------------ MongoDB Atlas ------------------
mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("MongoDB Connected"))
.catch(err => console.log("MongoDB Connection Error:", err));

// ------------------ Message Schema ------------------
const Message = mongoose.model("Message", new mongoose.Schema({
    username: String,
    content: String,
    type: { type: String, default: "text" }, // text or call
    timestamp: { type: Date, default: Date.now }
}));

// ------------------ Socket.IO ------------------
let users = {}; // socketId -> username

io.on("connection", socket => {
    console.log("Connected:", socket.id);

    // User joins
    socket.on("user join", async username => {
        socket.username = username;
        users[socket.id] = username;

        io.emit("users", users);

        // Send chat history
        try {
            const messages = await Message.find().sort({ timestamp: 1 });
            socket.emit("chat-history", messages);
        } catch(err) {
            console.log("Error fetching chat history:", err);
        }

        // Notify system
        const systemMsg = await Message.create({
            username: "System",
            content: `${username} joined`,
            type: "text"
        });
        io.emit("chat message", systemMsg);
    });

    // Chat message
    socket.on("chat message", async msg => {
        try {
            const saved = await Message.create(msg);
            io.emit("chat message", saved);
        } catch(err) {
            console.log("Error saving message:", err);
        }
    });

    // Call message
    socket.on("call-msg", async msg => {
        try {
            const saved = await Message.create({ ...msg, type: "call" });
            io.emit("chat message", saved);
        } catch(err) { console.log(err); }
    });

    // WebRTC signaling
    socket.on("call-user", ({ to, offer }) => {
        if(users[to]) io.to(to).emit("incoming-call", { from: socket.id, username: socket.username, offer });
    });

    socket.on("accept-call", ({ to, answer }) => {
        if(users[to]) io.to(to).emit("call-accepted", { from: socket.id, answer });
    });

    socket.on("reject-call", ({ to }) => {
        if(users[to]) io.to(to).emit("call-rejected");
    });

    socket.on("end-call", ({ to }) => {
        if(users[to]) io.to(to).emit("call-ended");
    });

    socket.on("ice-candidate", ({ to, candidate }) => {
        if(users[to]) io.to(to).emit("ice-candidate", candidate);
    });

    // Disconnect
    socket.on("disconnect", async () => {
        const username = socket.username;
        delete users[socket.id];
        io.emit("users", users);

        if(username){
            const systemMsg = await Message.create({
                username: "System",
                content: `${username} left the chat`,
                type: "text"
            });
            io.emit("chat message", systemMsg);
        }

        socket.broadcast.emit("call-ended");
        console.log(`Disconnected: ${socket.id}`);
    });
});

// ------------------ Frontend ------------------
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public/index.html"));
});

// ------------------ Server Port ------------------
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

console.log("Mongo URI exists:", !!process.env.MONGO_URI);
