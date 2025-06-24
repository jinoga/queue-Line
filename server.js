// server.js (ฉบับแก้ไขปัญหา Webhook Timeout)

// 1. โหลด Environment Variables จากไฟล์ .env ก่อนสิ่งอื่นใด
//require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
// ใช้ express.json({ verify: ... }) เพื่อให้เข้าถึง raw body สำหรับการตรวจสอบ signature ได้
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));
app.use(cors());

// --- 2. ดึงค่า Config ที่จำเป็นจาก Environment Variables ---
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const PORT = process.env.PORT || 3001;

// --- 3. ตรวจสอบความถูกต้องของ Config ---
if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_CHANNEL_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ CRITICAL ERROR: ค่า config ที่จำเป็น (Supabase หรือ LINE) ไม่ได้ถูกตั้งค่าใน .env file");
    process.exit(1); // หยุดการทำงานทันทีถ้าค่าไม่ครบ
}

// --- 4. สร้าง Supabase Client ด้วยค่าที่ถูกต้อง ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ---------------------------------------------------------------- //
//                                                                  //
//           ส่วนแก้ไขปัญหา Webhook Timeout อยู่ด้านล่างนี้            //
//                                                                  //
// ---------------------------------------------------------------- //


// ตรวจสอบลายเซ็น Line Webhook
function verifySignature(rawBody, signature) {
    if (!signature) {
        console.error("Signature is missing!");
        return false;
    }
    const hash = crypto
        .createHmac('sha256', LINE_CHANNEL_SECRET)
        .update(rawBody, 'utf-8')
        .digest('base64');
    return hash === signature;
}

// 🎯 หัวใจสำคัญ: Line Webhook - รับข้อความจากผู้ใช้ (ฉบับแก้ไข)
app.post('/webhook/line', (req, res) => {
    // 1. ตอบกลับ LINE ทันทีว่า "ได้รับข้อมูลแล้ว" เพื่อป้องกัน Timeout
    res.status(200).send('OK');

    // 2. ตรวจสอบ Signature เพื่อความปลอดภัย
    const signature = req.headers['x-line-signature'];
    // ใช้ req.rawBody ที่เราเตรียมไว้ก่อนหน้า
    if (!verifySignature(req.rawBody, signature)) {
        console.log('❌ Invalid signature. Ignoring request.');
        return; // ออกจากฟังก์ชัน ไม่ต้องทำอะไรต่อ
    }
    
    // 3. เริ่มประมวลผล Event ที่ได้รับมา "เบื้องหลัง" (ไม่ต้องรอให้เสร็จ)
    const events = req.body.events;
    if (events) {
        processEventsInBackground(events);
    }
});

// สร้างฟังก์ชันใหม่สำหรับประมวลผลเบื้องหลัง
async function processEventsInBackground(events) {
    console.log('📨 Processing events in background:', events.length);
    
    for (const event of events) {
        try {
            // โค้ดส่วนประมวลผลของคุณเหมือนเดิมทุกประการ
            if (event.type === 'message' && event.message.type === 'text') {
                await handleTextMessage(event);
            } else if (event.type === 'follow') {
                await handleFollow(event);
            } else if (event.type === 'unfollow') {
                await handleUnfollow(event);
            }
        } catch (error) {
            // การจัดการ Error ยังคงสำคัญ
            console.error('Error handling event in background:', error);
        }
    }
}


// 📝 จัดการข้อความที่ผู้ใช้พิมพ์
async function handleTextMessage(event) {
    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    
    console.log(`📱 User ${userId} sent: "${messageText}"`);
    
    const queueMatch = messageText.match(/^(\d{4,5})$/);
    
    if (queueMatch) {
        const queueNumber = queueMatch[1];
        console.log(`🎯 Queue registration: ${queueNumber}`);
        await registerQueueTracking(userId, queueNumber);
        await replyMessage(event.replyToken, [
            { type: 'text', text: `✅ ลงทะเบียนติดตามคิวเรียบร้อย!\n\n🎯 คิวที่ติดตาม: ${queueNumber}\n🔔 จะแจ้งเตือนเมื่อ:\n   • เหลือ 3 คิว (เตรียมตัว)\n   • ถึงคิวแล้ว (ไปเคาน์เตอร์)\n\n💡 คำสั่งอื่นๆ:\n   • พิมพ์ "เช็ค" = ดูสถานะคิว\n   • พิมพ์ "หยุด" = ยกเลิกการติดตาม\n   • พิมพ์เลขคิวใหม่ = เปลี่ยนคิว` }
        ]);
    } else if (['เช็ค', 'ตรวจสอบ', 'สถานะ', 'check', 'status'].includes(messageText.toLowerCase())) {
        console.log(`📊 Status check by: ${userId}`);
        await checkQueueStatus(userId, event.replyToken);
    } else if (['หยุด', 'ยกเลิก', 'stop', 'cancel'].includes(messageText.toLowerCase())) {
        console.log(`❌ Stop tracking by: ${userId}`);
        await stopQueueTracking(userId);
        await replyMessage(event.replyToken, [
            { type: 'text', text: '❌ หยุดติดตามคิวแล้ว\n\n📝 หากต้องการติดตามคิวใหม่:\nพิมพ์เลขคิว 4-5 หลัก (เช่น 1234)' }
        ]);
    } else {
        await replyMessage(event.replyToken, [
            { type: 'text', text: `🏢 ระบบแจ้งเตือนคิว\nสำนักงานที่ดิน จ.นครสวรรค์\n\n📋 วิธีใช้งาน:\n\n1️⃣ ติดตามคิว\n   พิมพ์เลขคิว 4-5 หลัก (เช่น 1234)\n\n2️⃣ เช็คสถานะ\n   พิมพ์ "เช็ค"\n\n3️⃣ หยุดติดตาม\n   พิมพ์ "หยุด"\n\n🕐 เวลาทำการ: 06:00-18:00 น.\n💡 ระบบจะแจ้งเตือนอัตโนมัติ!` }
        ]);
    }
}

// 👋 จัดการเมื่อมีคนเพิ่มเพื่อน
async function handleFollow(event) {
    const userId = event.source.userId;
    console.log(`👋 New follower: ${userId}`);
    
    const profile = await getUserProfile(userId);
    
    const { error } = await supabase
        .from('line_users')
        .upsert({
            line_user_id: userId,
            display_name: profile?.displayName || 'ไม่ระบุชื่อ',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        }, { onConflict: 'line_user_id' }); // เพิ่ม onConflict เพื่อความเสถียร

    if (error) console.error('Error saving user:', error);

    await replyMessage(event.replyToken, [
        { type: 'text', text: `🎉 ยินดีต้อนรับสู่ระบบแจ้งเตือนคิว!\n\n👋 สวัสดีคุณ ${profile?.displayName || 'ผู้ใช้'}\n\n🏢 สำนักงานที่ดิน จ.นครสวรรค์\n\n📋 เริ่มต้นใช้งาน:\n1. พิมพ์เลขคิวของคุณ (4-5 หลัก)\n2. ระบบจะแจ้งเตือนอัตโนมัติ\n\n💡 ตัวอย่าง: พิมพ์ "1234"\n\n🕐 เวลาทำการ: 06:00-18:00 น.` }
    ]);
}

// 👋 จัดการเมื่อมีคนเลิกติดตาม
async function handleUnfollow(event) {
    const userId = event.source.userId;
    console.log(`👋 User unfollowed: ${userId}`);
    
    await supabase
        .from('line_users')
        .update({ is_active: false, tracked_queue: null, updated_at: new Date().toISOString() })
        .eq('line_user_id', userId);
}

// 📝 ลงทะเบียนติดตามคิว
async function registerQueueTracking(userId, queueNumber) {
    const { error } = await supabase
        .from('line_users')
        .upsert({ line_user_id: userId, tracked_queue: queueNumber, is_active: true, updated_at: new Date().toISOString() }, { onConflict: 'line_user_id' });
    if (error) throw error;
    console.log(`✅ Registered queue ${queueNumber} for user ${userId}`);
}

// ❌ หยุดติดตามคิว
async function stopQueueTracking(userId) {
    const { error } = await supabase
        .from('line_users')
        .update({ tracked_queue: null, updated_at: new Date().toISOString() })
        .eq('line_user_id', userId);
    if (error) throw error;
    console.log(`❌ Stopped tracking for user ${userId}`);
}

// 📊 เช็คสถานะคิว
async function checkQueueStatus(userId, replyToken) {
    try {
        const { data: user, error: userError } = await supabase
            .from('line_users').select('tracked_queue, display_name').eq('line_user_id', userId).single();

        if (userError || !user?.tracked_queue) {
            await replyMessage(replyToken, [{ type: 'text', text: '❓ ยังไม่ได้ติดตามคิวใดๆ\n\n📝 เริ่มต้นใช้งาน:\nพิมพ์เลขคิว 4-5 หลัก (เช่น 1234)' }]);
            return;
        }

        const queueNumber = user.tracked_queue;
        const queueStatus = await getDetailedQueueStatus(queueNumber);
        
        await replyMessage(replyToken, [{ type: 'text', text: `📊 สถานะคิว ${queueNumber}\n👤 ${user.display_name}\n\n${queueStatus}\n\n🔄 อัพเดตล่าสุด: ${new Date().toLocaleTimeString('th-TH')}\n\n💡 พิมพ์ "เช็ค" เพื่อดูสถานะใหม่` }]);
    } catch (error) {
        console.error('Error checking queue status:', error);
        await replyMessage(replyToken, [{ type: 'text', text: '❌ ไม่สามารถตรวจสอบสถานะได้ในขณะนี้\nกรุณาลองใหม่อีกครั้ง' }]);
    }
}

// 🔍 ดึงสถานะคิวแบบละเอียด
async function getDetailedQueueStatus(queueNumber) {
    try {
        const counterId = getCounterIdFromQueue(queueNumber);
        if (!counterId) return '❌ รูปแบบเลขคิวไม่ถูกต้อง\n💡 ควรเป็น 4-5 หลัก (เช่น 1234, 10001)';

        const { data, error } = await supabase
            .from('queue_snapshots').select('current_queue, created_at').eq('current_counter', counterId).order('current_queue', { ascending: false }).limit(1);

        if (error) {
            console.error('Supabase error:', error);
            return '❌ เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล';
        }
        if (!data?.length) return `❓ ยังไม่มีข้อมูลสำหรับเคาน์เตอร์ ${counterId}\n💡 อาจยังไม่เปิดให้บริการ`;

        const latestCalled = parseInt(data[0].current_queue);
        const userQueue = parseInt(queueNumber);
        const lastUpdate = new Date(data[0].created_at).toLocaleTimeString('th-TH');
        
        if (userQueue < latestCalled) return `🚫 คิวผ่านไปแล้ว!\n📍 คิวล่าสุดที่เรียก: ${latestCalled}\n⏰ เมื่อ: ${lastUpdate}\n\n💡 กรุณาตรวจสอบที่เคาน์เตอร์ ${counterId}`;
        else if (userQueue === latestCalled) return `🎯 ถึงคิวแล้ว!\n🏃‍♂️ กรุณาไปที่เคาน์เตอร์ ${counterId} ทันที\n⏰ เรียกเมื่อ: ${lastUpdate}`;
        else {
            const remaining = userQueue - latestCalled;
            let statusEmoji = remaining <= 3 ? '⚠️' : (remaining <= 10 ? '🟡' : '⏳');
            let statusText = remaining <= 3 ? 'ใกล้ถึงแล้ว!' : (remaining <= 10 ? 'เตรียมตัวได้' : 'รอสักครู่');
            return `${statusEmoji} ${statusText}\n📊 เหลืออีก ${remaining} คิว\n📍 คิวล่าสุดที่เรียก: ${latestCalled}\n🪟 เคาน์เตอร์: ${counterId}\n⏰ อัพเดตล่าสุด: ${lastUpdate}`;
        }
    } catch (error) {
        console.error('Error getting queue status:', error);
        return '❌ ไม่สามารถตรวจสอบสถานะได้ในขณะนี้';
    }
}

// 🔢 แปลงเลขคิวเป็น ID เคาน์เตอร์
function getCounterIdFromQueue(queueNo) {
    const num = parseInt(String(queueNo).trim(), 10);
    if (isNaN(num)) return null;
    if (num >= 1001 && num <= 10999) return Math.floor(num / 1000); // รองรับได้หลายเคาเตอร์มากขึ้น
    return null;
}

// 👤 ดึงข้อมูลโปรไฟล์ผู้ใช้
async function getUserProfile(userId) {
    try {
        const response = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
            headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}` }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting user profile:', error.response?.data || error.message);
        return null;
    }
}

// 💬 ตอบกลับข้อความ
async function replyMessage(replyToken, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/reply', { replyToken, messages }, {
            headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log('✅ Reply sent successfully');
    } catch (error) {
        console.error('❌ Error replying message:', error.response?.data || error.message);
    }
}

// 📤 ส่งข้อความหาผู้ใช้โดยตรง
async function pushMessage(userId, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', { to: userId, messages }, {
            headers: { 'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }
        });
        console.log(`✅ Push message sent to ${userId}`);
    } catch (error) {
        console.error(`❌ Error pushing message to ${userId}:`, error.response?.data || error.message);
    }
}

// 🔔 ระบบแจ้งเตือนอัตโนมัติ
async function checkAndNotifyAllUsers() {
    console.log('🔍 Starting notification check...');
    try {
        const { data: users, error } = await supabase
            .from('line_users').select('line_user_id, tracked_queue, display_name').not('tracked_queue', 'is', null).eq('is_active', true);

        if (error) {
            console.error('Error fetching users:', error);
            return;
        }

        console.log(`👥 Found ${users.length} users tracking queues.`);
        let notificationsSent = 0;
        for (const user of users) {
            const notified = await checkAndNotifyUser(user);
            if (notified) notificationsSent++;
        }
        console.log(`🔔 Sent ${notificationsSent} notifications.`);
    } catch (error) {
        console.error('Error in notification system:', error);
    }
}

// 🎯 ตรวจสอบและแจ้งเตือนผู้ใช้แต่ละคน
async function checkAndNotifyUser(user) {
    const { line_user_id: userId, tracked_queue: queueNumber, display_name: displayName } = user;
    try {
        const counterId = getCounterIdFromQueue(queueNumber);
        if (!counterId) return false;

        const { data, error } = await supabase
            .from('queue_snapshots').select('current_queue').eq('current_counter', counterId).order('current_queue', { ascending: false }).limit(1);
        if (error || !data?.length) return false;

        const latestCalled = parseInt(data[0].current_queue);
        const userQueue = parseInt(queueNumber);
        const remaining = userQueue - latestCalled;
        const notificationKey = `${userId}_${queueNumber}`;

        if (userQueue === latestCalled) {
            if (!notificationCache.has(`${notificationKey}_current`)) {
                await pushMessage(userId, [{ type: 'text', text: `🎯 ถึงคิวแล้ว!\n\n👤 ${displayName}\n📢 คิว ${queueNumber}\n🏃‍♂️ กรุณาไปที่เคาน์เตอร์ ${counterId} ทันที!\n\n🏢 สำนักงานที่ดิน จ.นครสวรรค์\n⏰ ${new Date().toLocaleTimeString('th-TH')}` }]);
                notificationCache.set(`${notificationKey}_current`, Date.now());
                return true;
            }
        } else if (remaining > 0 && remaining <= 3) {
            if (!notificationCache.has(`${notificationKey}_near`)) {
                await pushMessage(userId, [{ type: 'text', text: `⚠️ ใกล้ถึงคิวแล้ว!\n\n👤 ${displayName}\n📢 คิว ${queueNumber}\n⏳ เหลืออีก ${remaining} คิว\n🚶‍♂️ กรุณาเตรียมตัวพร้อม\n\n💡 พิมพ์ "เช็ค" เพื่อดูสถานะล่าสุด` }]);
                notificationCache.set(`${notificationKey}_near`, Date.now());
                return true;
            }
        } else if (userQueue < latestCalled) {
            if (!notificationCache.has(`${notificationKey}_passed`)) {
                await pushMessage(userId, [{ type: 'text', text: `🚫 คิวผ่านไปแล้ว!\n\n👤 ${displayName}\n📢 คิว ${queueNumber}\n📍 คิวล่าสุดที่เรียก: ${latestCalled}\n\n💡 กรุณาตรวจสอบที่เคาน์เตอร์ ${counterId}\n🔄 หรือพิมพ์เลขคิวใหม่` }]);
                notificationCache.set(`${notificationKey}_passed`, Date.now());
                await stopQueueTracking(userId); // หยุดติดตามเมื่อคิวผ่านไปแล้ว
                return true;
            }
        }
        return false;
    } catch (err) {
        console.error(`Error checking user ${userId} queue ${queueNumber}:`, err);
        return false;
    }
}

// 💾 Cache สำหรับป้องกันการส่งซ้ำ
const notificationCache = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of notificationCache.entries()) {
        if (now - timestamp > 30 * 60 * 1000) { // 30 minutes
            notificationCache.delete(key);
        }
    }
    console.log(`🧹 Cleaned notification cache. Current size: ${notificationCache.size}`);
}, 30 * 60 * 1000);

// 🌐 API Endpoints (ส่วนนี้เหมือนเดิม)
app.post('/api/notify-queue-updates', async (req, res) => {
    console.log('📡 Queue update notification triggered');
    await checkAndNotifyAllUsers();
    res.json({ success: true });
});
app.get('/api/status', (req, res) => res.json({ status: 'running', uptime: process.uptime() }));


// 🔄 ระบบตรวจสอบอัตโนมัติทุก 30 วินาที
setInterval(checkAndNotifyAllUsers, 30000);

app.get('/debug-vars', (req, res) => {
    console.log("--- DEBUGGING ENVIRONMENT VARIABLES ---");
    
    const variables = {
        PORT: process.env.PORT ? `✅ Found: ${process.env.PORT}` : "❌ MISSING!",
        SUPABASE_URL: process.env.SUPABASE_URL ? "✅ Found" : "❌ MISSING!",
        SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY ? "✅ Found (exists)" : "❌ MISSING!",
        LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN ? "✅ Found (exists)" : "❌ MISSING!",
        LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET ? "✅ Found (exists)" : "❌ MISSING!",
    };

    console.table(variables);
    res.json(variables); // ส่งผลลัพธ์กลับไปให้เราดูใน browser ด้วย
});

// 🌐 เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`🚀 Line Notification Server running on port ${PORT}`);
    console.log(`🔔 Auto-notification: Active (every 30 seconds)`);
});

// 🔧 จัดการ graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 Received SIGTERM, shutting down gracefully...');
    process.exit(0);
});
process.on('SIGINT', () => {
    console.log('🛑 Received SIGINT, shutting down gracefully...');
    process.exit(0);
});

module.exports = app;
