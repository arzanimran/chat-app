const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/chat-app')
.then(()=>console.log("MongoDB connected"))
.catch(err=>console.log(err));

// Schema
const messageSchema = new mongoose.Schema({
    username: String,
    type: String,
    content: String,
    filename: String,
    timestamp: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Home
app.get('/', (req,res)=>{
    res.sendFile(path.join(__dirname,'public/index.html'));
});

// ✅ DELETE MESSAGE (OWNER ONLY)
app.delete('/api/message/:id', async (req,res)=>{
    const { username } = req.body;

    try {
        const msg = await Message.findById(req.params.id);
        if(!msg) return res.status(404).json({ success:false });

        // 🔐 ownership check
        if(msg.username !== username){
            return res.status(403).json({ success:false, message:"Not allowed" });
        }

        await Message.findByIdAndDelete(req.params.id);
        res.json({ success:true });
    } catch(err){
        res.json({ success:false });
    }
});

// Socket
io.on('connection', (socket)=>{
    console.log("Connected:", socket.id);

    socket.on('request messages', async ()=>{
        const msgs = await Message.find().sort({ timestamp:1 });
        socket.emit('load messages', msgs);
    });

    socket.on('user join', username=>{
        socket.username = username;
        io.emit('chat message', {
            username:'System',
            type:'text',
            content:`${username} joined the chat`,
            timestamp:new Date()
        });
    });

    socket.on('chat message', async msg=>{
        const saved = await Message.create(msg);
        io.emit('chat message', saved);
    });

    socket.on('disconnect', ()=>{
        if(socket.username){
            io.emit('chat message',{
                username:'System',
                type:'text',
                content:`${socket.username} left the chat`,
                timestamp:new Date()
            });
        }
    });
});

server.listen(3000, ()=>console.log("Server running on http://localhost:3000"));
