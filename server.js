// server.js (ฉบับสมบูรณ์: แจ้งเตือน 5 คิว + ป้องกันคิวซ้ำ)

// 1. โหลด Environment Variables
//require('dotenv').config();

// --- Dependencies ---
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

// --- Express App Initialization & Middleware ---
const app = express();

const corsOptions = {
  origin: 'https://queue-monitor.vercel.app', // ❗️ แก้ไขให้เป็น URL ของ Frontend คุณ
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  optionsSuccessStatus: 204
};
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));


// --- Config and Supabase Client Setup ---
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 3001;

if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ CRITICAL ERROR: Environment Variables ไม่ครบถ้วน!");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


// --- Core Functions ---
function verifySignature(rawBody, signature) {
    if (!signature || !rawBody) return false;
    const hash = crypto.createHmac('sha256', LINE_CHANNEL_SECRET).update(rawBody, 'utf-8').digest('base64');
    return hash === signature;
}

async function processEventsInBackground(events) {
    console.log(`📨 Processing ${events.length} event(s) in background.`);
    for (const event of events) {
        try {
            if (event.type === 'message' && event.message.type === 'text') await handleTextMessage(event);
            else if (event.type === 'follow') await handleFollow(event);
            else if (event.type === 'unfollow') await handleUnfollow(event);
        } catch (error) {
            console.error('Error handling event:', error);
        }
    }
}

// --- Webhook Endpoint ---
app.post('/webhook/line', (req, res) => {
    res.status(200).send('OK');
    const signature = req.headers['x-line-signature'];
    if (!verifySignature(req.rawBody, signature)) {
        console.log('❌ Invalid signature. Ignoring request.');
        return;
    }
    const events = req.body.events;
    if (events && events.length > 0) {
        processEventsInBackground(events);
    }
});


// --- Business Logic & Handlers ---

async function handleTextMessage(event) {
    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    console.log(`📱 User ${userId.substring(0,10)}... sent: "${messageText}"`);
    
    const queueMatch = messageText.match(/^(\d{4,5})$/);
    if (queueMatch) {
        const queueNumber = queueMatch[1];
        // ✅ เรียกใช้ฟังก์ชันใหม่ที่มีระบบตรวจสอบคิวซ้ำ
        await registerOrNotifyDuplicateQueue(userId, queueNumber, event.replyToken);
    } else if (['เช็ค', 'ตรวจสอบ', 'สถานะ', 'check', 'status'].includes(messageText.toLowerCase())) {
        await checkQueueStatus(userId, event.replyToken);
    } else if (['หยุด', 'ยกเลิก', 'stop', 'cancel'].includes(messageText.toLowerCase())) {
        await stopQueueTracking(userId);
        await replyMessage(event.replyToken, [{ type: 'text', text: '❌ หยุดติดตามคิวแล้ว' }]);
    } else {
        await replyMessage(event.replyToken, [{ type: 'text', text: `🏢 ระบบแจ้งเตือนคิว\n\nพิมพ์เลขคิว 4-5 หลัก เพื่อเริ่มใช้งาน` }]);
    }
}

// ✅ ฟังก์ชันใหม่: ตรวจสอบคิวซ้ำก่อนลงทะเบียน
async function registerOrNotifyDuplicateQueue(userId, queueNumber, replyToken) {
    try {
        const { data: existingUser, error: findError } = await supabase
            .from('line_users')
            .select('line_user_id, display_name')
            .eq('tracked_queue', queueNumber)
            .not('line_user_id', 'eq', userId)
            .limit(1)
            .single();

        if (findError && findError.code !== 'PGRST116') throw findError;

        if (existingUser) {
            console.log(`❌ Duplicate queue! Queue ${queueNumber} is already tracked by ${existingUser.display_name}`);
            const message = `ขออภัยค่ะ 🙏\n\nคิวหมายเลข ${queueNumber} มีผู้ใช้งานอื่นติดตามอยู่แล้ว ("${existingUser.display_name}")\n\nกรุณาตรวจสอบหมายเลขคิวของคุณอีกครั้งค่ะ`;
            await replyMessage(replyToken, [{ type: 'text', text: message }]);
        } else {
            console.log(`✅ Queue ${queueNumber} is available. Registering...`);
            await registerQueueTracking(userId, queueNumber);
            await replyMessage(replyToken, [{ type: 'text', text: `✅ ลงทะเบียนสำเร็จ!\n\nคิวที่ติดตาม: ${queueNumber}\n🔔 จะแจ้งเตือนเมื่อเหลือ 5 คิว` }]);
        }
    } catch (error) {
        console.error("Error in registerOrNotifyDuplicateQueue:", error);
        await replyMessage(replyToken, [{ type: 'text', "text": "เกิดข้อผิดพลาดในการตรวจสอบคิว" }]);
    }
}

async function handleFollow(event) {
    const userId = event.source.userId;
    console.log(`👋 New follower: ${userId}`);
    const profile = await getUserProfile(userId);
    await supabase.from('line_users').upsert({ line_user_id: userId, display_name: profile?.displayName || 'ไม่ระบุชื่อ', is_active: true }, { onConflict: 'line_user_id' });
    await replyMessage(event.replyToken, [{ type: 'text', text: `🎉 ยินดีต้อนรับ!\n\nสวัสดีคุณ ${profile?.displayName || 'ผู้ใช้'}\n\nเพียงพิมพ์เลขคิว 4-5 หลัก เพื่อเริ่มรับการแจ้งเตือน` }]);
}

async function handleUnfollow(event) {
    console.log(`👋 User unfollowed: ${event.source.userId}`);
    await supabase.from('line_users').update({ is_active: false, tracked_queue: null }).eq('line_user_id', event.source.userId);
}

async function registerQueueTracking(userId, queueNumber) {
    await supabase.from('line_users').update({ tracked_queue: queueNumber }).eq('line_user_id', userId);
    console.log(`✅ Registered queue ${queueNumber} for user ${userId.substring(0,10)}...`);
}

async function stopQueueTracking(userId) {
    await supabase.from('line_users').update({ tracked_queue: null }).eq('line_user_id', userId);
    console.log(`❌ Stopped tracking for user ${userId.substring(0,10)}...`);
}

async function checkQueueStatus(userId, replyToken) {
    const { data: user } = await supabase.from('line_users').select('tracked_queue, display_name').eq('line_user_id', userId).single();
    if (!user?.tracked_queue) {
        await replyMessage(replyToken, [{ type: 'text', text: '❓ ยังไม่ได้ติดตามคิวใดๆ' }]);
        return;
    }
    const queueStatus = await getDetailedQueueStatus(user.tracked_queue);
    await replyMessage(replyToken, [{ type: 'text', text: `📊 สถานะคิว ${user.tracked_queue}\n${queueStatus}` }]);
}

async function getDetailedQueueStatus(queueNumber) {
    const counterId = getCounterIdFromQueue(queueNumber);
    if (!counterId) return '❌ รูปแบบเลขคิวไม่ถูกต้อง';
    const { data, error } = await supabase.from('queue_snapshots').select('current_queue').eq('current_counter', counterId).order('current_queue', { ascending: false }).limit(1);
    if (error || !data?.length) return `❓ ยังไม่มีข้อมูลสำหรับเคาน์เตอร์ ${counterId}`;
    const latestCalled = parseInt(data[0].current_queue);
    const userQueue = parseInt(queueNumber);
    if (userQueue < latestCalled) return `🚫 คิวผ่านไปแล้ว! (คิวล่าสุด: ${latestCalled})`;
    if (userQueue === latestCalled) return `🎯 ถึงคิวแล้ว! เชิญที่เคาน์เตอร์ ${counterId}`;
    const remaining = userQueue - latestCalled;
    // ✅ แจ้งเตือนล่วงหน้าที่ 5 คิว
    return remaining <= 5 ? `⚠️ ใกล้ถึงแล้ว! (เหลือ ${remaining} คิว)` : `⏳ รออีก ${remaining} คิว`;
}

function getCounterIdFromQueue(queueNo) {
    const num = parseInt(String(queueNo).trim(), 10);
    if (isNaN(num) || num < 1001 || num > 10999) return null;
    return Math.floor(num / 1000);
}

async function getUserProfile(userId) {
    try {
        const response = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, { headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } });
        return response.data;
    } catch (error) { console.error('Error getting user profile:', error.message); return null; }
}

async function replyMessage(replyToken, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages }, { headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } });
    } catch (error) { console.error('❌ Error replying message:', error.message); }
}

async function pushMessage(userId, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages }, { headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` } });
    } catch (error) { console.error(`❌ Error pushing message to ${userId}:`, error.message); }
}


// --- Notification System (Upgraded for Scale) ---

const notificationCache = new Map();

async function checkAndNotifyAllUsers() {
    console.log('🔍 Starting notification check...');
    try {
        const { data: users, error } = await supabase.from('line_users').select('line_user_id, tracked_queue, display_name').not('tracked_queue', 'is', null).eq('is_active', true);
        if (error) { console.error('Error fetching users:', error); return; }
        if (users.length === 0) return;
        console.log(`👥 Found ${users.length} users. Processing in parallel...`);

        const notificationPromises = users.map(user => checkAndNotifyUser(user));
        const results = await Promise.all(notificationPromises);
        const notificationsSent = results.filter(Boolean).length;
        
        if (notificationsSent > 0) {
            console.log(`🔔 Parallel processing complete. Sent ${notificationsSent} notifications.`);
        }
    } catch (error) {
        console.error('Error in parallel notification system:', error);
    }
}

async function checkAndNotifyUser(user) {
    const { line_user_id: userId, tracked_queue: queueNumber } = user;
    try {
        const counterId = getCounterIdFromQueue(queueNumber);
        if (!counterId) return false;

        const { data, error } = await supabase.from('queue_snapshots').select('current_queue').eq('current_counter', counterId).order('current_queue', { ascending: false }).limit(1);
        if (error || !data?.length) return false;

        const latestCalled = parseInt(data[0].current_queue);
        const userQueue = parseInt(queueNumber);
        const remaining = userQueue - latestCalled;
        const notificationKey = `${userId}_${queueNumber}`;
        
        let notificationType = null;
        let message = '';

        if (userQueue === latestCalled) notificationType = 'current';
        // ✅ แจ้งเตือนล่วงหน้าที่ 5 คิว
        else if (remaining > 0 && remaining <= 5) notificationType = 'near';
        else if (userQueue < latestCalled) notificationType = 'passed';

        // CONCISE DEBUG LOG
        console.log(`[CHECK] User: ${user.display_name}, Q: ${userQueue}, Latest: ${latestCalled}, Remaining: ${remaining}, Notify: ${notificationType || 'No'}`);

        if (notificationType && !notificationCache.has(`${notificationKey}_${notificationType}`)) {
            if (notificationType === 'current') message = `🎯 ถึงคิวแล้ว! คิว ${queueNumber} เชิญที่เคาน์เตอร์ ${counterId}`;
            if (notificationType === 'near') message = `⚠️ ใกล้ถึงแล้ว! คิว ${queueNumber} (เหลือ ${remaining} คิว)`;
            if (notificationType === 'passed') message = `🚫 คิว ${queueNumber} ผ่านไปแล้ว (คิวล่าสุด: ${latestCalled})`;
            
            await pushMessage(userId, [{ type: 'text', text: message }]);
            notificationCache.set(`${notificationKey}_${notificationType}`, Date.now());

            if(notificationType === 'passed' || notificationType === 'current') {
                await stopQueueTracking(userId);
// หยุดติดตามเมื่อถึงคิวหรือคิวผ่านไปแล้ว
            }
            return true;
        }
        return false;
    } catch (err) {
        console.error(`💥 Error checking user ${userId}:`, err);
        return false;
    }
}


// --- Server Startup ---

// 🔄 ระบบตรวจสอบอัตโนมัติทุก 30 วินาที
setInterval(checkAndNotifyAllUsers, 30000);

// 🌐 เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`🚀 Line Notification Server running on port ${PORT}`);
    console.log(`🔔 Auto-notification: Active (every 30 seconds)`);
});

module.exports = app;
