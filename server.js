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

/* ========= PASSWORD ========= */
app.post("/api/check-pass", (req, res) => {
  res.json({ success: req.body.password === "arzan" });
});

/* ========= MONGODB ========= */
console.log("Mongo URI exists:", !!process.env.MONGO_URI);
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
  .then(() => console.log("MongoDB Connected Successfully"))
  .catch(err => {
    console.error("MongoDB Connection Error:", err);
    process.exit(1);
  });

const Message = mongoose.model(
  "Message",
  new mongoose.Schema({
    username: { type: String, required: true },
    content: { type: String, required: true },
    type: { type: String, default: "text" }, // "text" or "image"
    timestamp: { type: Date, default: Date.now }
  })
);

/* ========= SOCKET ========= */
let users = {};

io.on("connection", socket => {
  console.log("Connected:", socket.id);

  socket.on("user join", async username => {
    if (!username) return;

    socket.username = username;
    users[socket.id] = username;
    io.emit("users", users);

    try {
      const history = await Message.find()
        .sort({ timestamp: -1 })
        .limit(100);
      console.log(`Fetched ${history.length} messages from history for ${username}`);
      socket.emit("chat-history", history);
    } catch (err) {
      console.error("Error fetching chat history:", err);
      socket.emit("chat-history", []);
    }

    try {
      const joinMsg = await Message.create({
        username: "System",
        content: `${username} joined`
      });
      console.log("Saved join message:", joinMsg);
      io.emit("chat message", joinMsg);
    } catch (err) {
      console.error("Error saving join message:", err);
      io.emit("chat message", {
        username: "System",
        content: `${username} joined`,
        timestamp: new Date()
      });
    }
  });

  socket.on("chat message", async msg => {
    if (!msg?.username || !msg?.content) return;

    console.log("Attempting to save message:", msg.type, msg.username); // Debug
    try {
      const saved = await Message.create(msg);
      console.log("Saved successfully:", saved._id, saved.type); // Debug
      io.emit("chat message", saved);
    } catch (err) {
      console.error("Error saving chat message:", err);
      io.emit("chat message", { ...msg, timestamp: new Date() });
    }
  });

  socket.on("disconnect", async () => {
    const name = socket.username;
    delete users[socket.id];
    io.emit("users", users);

    if (name) {
      try {
        const left = await Message.create({
          username: "System",
          content: `${name} left`
        });
        console.log("Saved leave message:", left);
        io.emit("chat message", left);
      } catch (err) {
        console.error("Error saving leave message:", err);
        io.emit("chat message", {
          username: "System",
          content: `${name} left`,
          timestamp: new Date()
        });
      }
    }
  });

  // Call-related events
  socket.on("call-user", (data) => {
    io.to(data.to).emit("incoming-call", { from: socket.id, offer: data.offer, username: data.username });
  });

  socket.on("accept-call", (data) => {
    io.to(data.to).emit("call-accepted", { answer: data.answer });
  });

  socket.on("reject-call", (data) => {
    io.to(data.to).emit("call-rejected");
  });

  socket.on("end-call", (data) => {
    io.to(data.to).emit("call-ended");
  });

  socket.on("ice-candidate", (data) => {
    io.to(data.to).emit("ice-candidate", data.candidate);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on port ${PORT}`)
);