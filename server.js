// server.js (ฉบับแก้ไข)

// 1. โหลด Environment Variables จากไฟล์ .env ก่อนสิ่งอื่นใด
//require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const cors = require('cors');

const app = express();
app.use(express.json());
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
    console.error("กรุณาตรวจสอบว่าไฟล์ .env ของคุณมีตัวแปรครบถ้วน:");
    console.error("  - LINE_CHANNEL_ACCESS_TOKEN");
    console.error("  - LINE_CHANNEL_SECRET");
    console.error("  - SUPABASE_URL");
    console.error("  - SUPABASE_SERVICE_KEY");
    process.exit(1); // หยุดการทำงานทันทีถ้าค่าไม่ครบ
}

// --- 4. สร้าง Supabase Client ด้วยค่าที่ถูกต้อง ---
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);


// ---------------------------------------------------------------- //
//                                                                  //
//           โค้ดส่วนที่เหลือของคุณไม่ต้องแก้ไข (สมบูรณ์แล้ว)           //
//                                                                  //
// ---------------------------------------------------------------- //


// ตรวจสอบลายเซ็น Line Webhook
function verifySignature(body, signature) {
    const hash = crypto
        .createHmac('sha256', LINE_CHANNEL_SECRET)
        .update(body, 'utf-8')
        .digest('base64');
    return hash === signature;
}

// 🎯 หัวใจสำคัญ: Line Webhook - รับข้อความจากผู้ใช้
app.post('/webhook/line', async (req, res) => {
    const signature = req.headers['x-line-signature'];
    const body = JSON.stringify(req.body);

    // ตรวจสอบความปลอดภัย
    if (!verifySignature(body, signature)) {
        console.log('❌ Invalid signature');
        return res.status(401).send('Unauthorized');
    }

    const events = req.body.events;
    console.log('📨 Received events:', events.length);
    
    for (const event of events) {
        try {
            if (event.type === 'message' && event.message.type === 'text') {
                await handleTextMessage(event);
            } else if (event.type === 'follow') {
                await handleFollow(event);
            } else if (event.type === 'unfollow') {
                await handleUnfollow(event);
            }
        } catch (error) {
            console.error('Error handling event:', error);
        }
    }

    res.status(200).send('OK');
});

// 📝 จัดการข้อความที่ผู้ใช้พิมพ์
async function handleTextMessage(event) {
    const userId = event.source.userId;
    const messageText = event.message.text.trim();
    
    console.log(`📱 User ${userId} sent: "${messageText}"`);
    
    // 1️⃣ ตรวจสอบว่าเป็นเลขคิวหรือไม่ (4-5 หลัก)
    const queueMatch = messageText.match(/^(\d{4,5})$/);
    
    if (queueMatch) {
        const queueNumber = queueMatch[1];
        console.log(`🎯 Queue registration: ${queueNumber}`);
        
        // ลงทะเบียนติดตามคิว
        await registerQueueTracking(userId, queueNumber);
        
        // ส่งข้อความยืนยัน
        await replyMessage(event.replyToken, [
            {
                type: 'text',
                text: `✅ ลงทะเบียนติดตามคิวเรียบร้อย!\n\n🎯 คิวที่ติดตาม: ${queueNumber}\n🔔 จะแจ้งเตือนเมื่อ:\n   • เหลือ 3 คิว (เตรียมตัว)\n   • ถึงคิวแล้ว (ไปเคาน์เตอร์)\n\n💡 คำสั่งอื่นๆ:\n   • พิมพ์ "เช็ค" = ดูสถานะคิว\n   • พิมพ์ "หยุด" = ยกเลิกการติดตาม\n   • พิมพ์เลขคิวใหม่ = เปลี่ยนคิว`
            }
        ]);
        
    } 
    // 2️⃣ เช็คสถานะคิว
    else if (['เช็ค', 'ตรวจสอบ', 'สถานะ', 'check', 'status'].includes(messageText.toLowerCase())) {
        console.log(`📊 Status check by: ${userId}`);
        await checkQueueStatus(userId, event.replyToken);
    } 
    // 3️⃣ หยุดติดตาม
    else if (['หยุด', 'ยกเลิก', 'stop', 'cancel'].includes(messageText.toLowerCase())) {
        console.log(`❌ Stop tracking by: ${userId}`);
        await stopQueueTracking(userId);
        await replyMessage(event.replyToken, [
            {
                type: 'text',
                text: '❌ หยุดติดตามคิวแล้ว\n\n📝 หากต้องการติดตามคิวใหม่:\nพิมพ์เลขคิว 4-5 หลัก (เช่น 1234)'
            }
        ]);
    } 
    // 4️⃣ ข้อมูลช่วยเหลือ
    else {
        await replyMessage(event.replyToken, [
            {
                type: 'text',
                text: `🏢 ระบบแจ้งเตือนคิว\nสำนักงานที่ดิน จ.นครสวรรค์\n\n📋 วิธีใช้งาน:\n\n1️⃣ ติดตามคิว\n   พิมพ์เลขคิว 4-5 หลัก (เช่น 1234)\n\n2️⃣ เช็คสถานะ\n   พิมพ์ "เช็ค"\n\n3️⃣ หยุดติดตาม\n   พิมพ์ "หยุด"\n\n🕐 เวลาทำการ: 06:00-18:00 น.\n💡 ระบบจะแจ้งเตือนอัตโนมัติ!`
            }
        ]);
    }
}

// 👋 จัดการเมื่อมีคนเพิ่มเพื่อน
async function handleFollow(event) {
    const userId = event.source.userId;
    console.log(`👋 New follower: ${userId}`);
    
    // ดึงข้อมูลโปรไฟล์ผู้ใช้
    const profile = await getUserProfile(userId);
    
    // บันทึกลงฐานข้อมูล
    const { error } = await supabase
        .from('line_users')
        .upsert({
            line_user_id: userId,
            display_name: profile?.displayName || 'ไม่ระบุชื่อ',
            is_active: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error('Error saving user:', error);
    }

    // ส่งข้อความต้อนรับ
    await replyMessage(event.replyToken, [
        {
            type: 'text',
            text: `🎉 ยินดีต้อนรับสู่ระบบแจ้งเตือนคิว!\n\n👋 สวัสดีคุณ ${profile?.displayName || 'ผู้ใช้'}\n\n🏢 สำนักงานที่ดิน จ.นครสวรรค์\n\n📋 เริ่มต้นใช้งาน:\n1. พิมพ์เลขคิวของคุณ (4-5 หลัก)\n2. ระบบจะแจ้งเตือนอัตโนมัติ\n\n💡 ตัวอย่าง: พิมพ์ "1234"\n\n🕐 เวลาทำการ: 06:00-18:00 น.`
        }
    ]);
}

// 👋 จัดการเมื่อมีคนเลิกติดตาม
async function handleUnfollow(event) {
    const userId = event.source.userId;
    console.log(`👋 User unfollowed: ${userId}`);
    
    await supabase
        .from('line_users')
        .update({ 
            is_active: false, 
            tracked_queue: null,
            updated_at: new Date().toISOString()
        })
        .eq('line_user_id', userId);
}

// 📝 ลงทะเบียนติดตามคิว
async function registerQueueTracking(userId, queueNumber) {
    const { error } = await supabase
        .from('line_users')
        .upsert({
            line_user_id: userId,
            tracked_queue: queueNumber,
            is_active: true,
            updated_at: new Date().toISOString()
        });

    if (error) {
        console.error('Error registering queue:', error);
        throw error;
    }

    console.log(`✅ Registered queue ${queueNumber} for user ${userId}`);
}

// ❌ หยุดติดตามคิว
async function stopQueueTracking(userId) {
    const { error } = await supabase
        .from('line_users')
        .update({ 
            tracked_queue: null,
            updated_at: new Date().toISOString()
        })
        .eq('line_user_id', userId);

    if (error) {
        console.error('Error stopping tracking:', error);
        throw error;
    }

    console.log(`❌ Stopped tracking for user ${userId}`);
}

// 📊 เช็คสถานะคิว
async function checkQueueStatus(userId, replyToken) {
    try {
        // ดึงข้อมูลคิวที่ผู้ใช้ติดตาม
        const { data: user, error: userError } = await supabase
            .from('line_users')
            .select('tracked_queue, display_name')
            .eq('line_user_id', userId)
            .single();

        if (userError || !user?.tracked_queue) {
            await replyMessage(replyToken, [
                {
                    type: 'text',
                    text: '❓ ยังไม่ได้ติดตามคิวใดๆ\n\n📝 เริ่มต้นใช้งาน:\nพิมพ์เลขคิว 4-5 หลัก (เช่น 1234)'
                }
            ]);
            return;
        }

        const queueNumber = user.tracked_queue;
        console.log(`📊 Checking status for queue ${queueNumber}`);

        // ดึงสถานะคิวจากระบบ
        const queueStatus = await getDetailedQueueStatus(queueNumber);
        
        await replyMessage(replyToken, [
            {
                type: 'text',
                text: `📊 สถานะคิว ${queueNumber}\n👤 ${user.display_name}\n\n${queueStatus}\n\n🔄 อัพเดตล่าสุด: ${new Date().toLocaleTimeString('th-TH')}\n\n💡 พิมพ์ "เช็ค" เพื่อดูสถานะใหม่`
            }
        ]);

    } catch (error) {
        console.error('Error checking queue status:', error);
        await replyMessage(replyToken, [
            {
                type: 'text',
                text: '❌ ไม่สามารถตรวจสอบสถานะได้ในขณะนี้\nกรุณาลองใหม่อีกครั้ง'
            }
        ]);
    }
}

// 🔍 ดึงสถานะคิวแบบละเอียด
async function getDetailedQueueStatus(queueNumber) {
    try {
        const counterId = getCounterIdFromQueue(queueNumber);
        
        if (!counterId) {
            return '❌ รูปแบบเลขคิวไม่ถูกต้อง\n💡 ควรเป็น 4-5 หลัก (เช่น 1234, 10001)';
        }

        // ดึงคิวล่าสุดของเคาน์เตอร์นั้น
        const { data, error } = await supabase
            .from('queue_snapshots')
            .select('current_queue, created_at')
            .eq('current_counter', counterId)
            .order('current_queue', { ascending: false })
            .limit(1);

        if (error) {
            console.error('Supabase error:', error);
            return '❌ เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล';
        }

        if (!data?.length) {
            return `❓ ยังไม่มีข้อมูลสำหรับเคาน์เตอร์ ${counterId}\n💡 อาจยังไม่เปิดให้บริการ`;
        }

        const latestCalled = parseInt(data[0].current_queue);
        const userQueue = parseInt(queueNumber);
        const lastUpdate = new Date(data[0].created_at).toLocaleTimeString('th-TH');
        
        if (userQueue < latestCalled) {
            return `🚫 คิวผ่านไปแล้ว!\n📍 คิวล่าสุดที่เรียก: ${latestCalled}\n⏰ เมื่อ: ${lastUpdate}\n\n💡 กรุณาตรวจสอบที่เคาน์เตอร์ ${counterId}`;
        } 
        else if (userQueue === latestCalled) {
            return `🎯 ถึงคิวแล้ว!\n🏃‍♂️ กรุณาไปที่เคาน์เตอร์ ${counterId} ทันที\n⏰ เรียกเมื่อ: ${lastUpdate}`;
        } 
        else {
            const remaining = userQueue - latestCalled;
            let statusEmoji = '';
            let statusText = '';
            
            if (remaining <= 3) {
                statusEmoji = '⚠️';
                statusText = 'ใกล้ถึงแล้ว!';
            } else if (remaining <= 10) {
                statusEmoji = '🟡';
                statusText = 'เตรียมตัวได้';
            } else {
                statusEmoji = '⏳';
                statusText = 'รอสักครู่';
            }
            
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
    
    if (num >= 1001 && num <= 1999) return 1;
    if (num >= 2001 && num <= 2999) return 2;
    if (num >= 3001 && num <= 3999) return 3;
    if (num >= 4001 && num <= 4999) return 4;
    if (num >= 5001 && num <= 5999) return 5;
    if (num >= 6001 && num <= 6999) return 6;
    if (num >= 7001 && num <= 7999) return 7;
    if (num >= 8001 && num <= 8999) return 8;
    if (num >= 9001 && num <= 9999) return 9;
    if (num >= 10001 && num <= 10999) return 10;
    
    return null;
}

// 👤 ดึงข้อมูลโปรไฟล์ผู้ใช้
async function getUserProfile(userId) {
    try {
        const response = await axios.get(`https://api.line.me/v2/bot/profile/${userId}`, {
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`
            }
        });
        return response.data;
    } catch (error) {
        console.error('Error getting user profile:', error);
        return null;
    }
}

// 💬 ตอบกลับข้อความ
async function replyMessage(replyToken, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/reply', {
            replyToken,
            messages
        }, {
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Reply sent successfully');
    } catch (error) {
        console.error('❌ Error replying message:', error.response?.data || error.message);
        throw error;
    }
}

// 📤 ส่งข้อความหาผู้ใช้โดยตรง
async function pushMessage(userId, messages) {
    try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
            to: userId,
            messages
        }, {
            headers: {
                'Authorization': `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ Push message sent to ${userId}`);
    } catch (error) {
        console.error(`❌ Error pushing message to ${userId}:`, error.response?.data || error.message);
        throw error;
    }
}

// 🔔 ระบบแจ้งเตือนอัตโนมัติ (หัวใจสำคัญ!)
async function checkAndNotifyAllUsers() {
    try {
        console.log('🔍 Starting notification check...');
        
        // ดึงผู้ใช้ทั้งหมดที่ติดตามคิว
        const { data: users, error } = await supabase
            .from('line_users')
            .select('line_user_id, tracked_queue, display_name')
            .not('tracked_queue', 'is', null)
            .eq('is_active', true);

        if (error) {
            console.error('Error fetching users:', error);
            return { success: false, error: error.message };
        }

        console.log(`👥 Found ${users.length} users tracking queues`);

        let notificationsSent = 0;
        
        for (const user of users) {
            try {
                const notified = await checkAndNotifyUser(user);
                if (notified) notificationsSent++;
            } catch (error) {
                console.error(`Error notifying user ${user.line_user_id}:`, error);
            }
        }

        console.log(`🔔 Sent ${notificationsSent} notifications`);
        return { 
            success: true, 
            totalUsers: users.length, 
            notificationsSent 
        };

    } catch (error) {
        console.error('Error in notification system:', error);
        return { success: false, error: error.message };
    }
}

// 🎯 ตรวจสอบและแจ้งเตือนผู้ใช้แต่ละคน
async function checkAndNotifyUser(user) {
    const { line_user_id: userId, tracked_queue: queueNumber, display_name: displayName } = user;
    
    try {
        const counterId = getCounterIdFromQueue(queueNumber);
        if (!counterId) return false;

        // ดึงคิวล่าสุด
        const { data, error } = await supabase
            .from('queue_snapshots')
            .select('current_queue')
            .eq('current_counter', counterId)
            .order('current_queue', { ascending: false })
            .limit(1);

        if (error || !data?.length) return false;

        const latestCalled = parseInt(data[0].current_queue);
        const userQueue = parseInt(queueNumber);
        const remaining = userQueue - latestCalled;

        // สร้าง key สำหรับเช็คว่าแจ้งเตือนไปแล้วหรือยัง
        const notificationKey = `${userId}_${queueNumber}`;

        if (userQueue === latestCalled) {
            // 🎯 ถึงคิวแล้ว!
            if (!notificationCache.has(`${notificationKey}_current`)) {
                await pushMessage(userId, [{
                    type: 'text',
                    text: `🎯 ถึงคิวแล้ว!\n\n👤 ${displayName}\n📢 คิว ${queueNumber}\n🏃‍♂️ กรุณาไปที่เคาน์เตอร์ ${counterId} ทันที!\n\n🏢 สำนักงานที่ดิน จ.นครสวรรค์\n⏰ ${new Date().toLocaleTimeString('th-TH')}`
                }]);
                
                notificationCache.set(`${notificationKey}_current`, Date.now());
                console.log(`🎯 Sent CURRENT notification to ${userId} for queue ${queueNumber}`);
                return true;
            }
        } 
        else if (remaining <= 3 && remaining > 0) {
            // ⚠️ ใกล้ถึงคิว!
            if (!notificationCache.has(`${notificationKey}_near`)) {
                await pushMessage(userId, [{
                    type: 'text',
                    text: `⚠️ ใกล้ถึงคิวแล้ว!\n\n👤 ${displayName}\n📢 คิว ${queueNumber}\n⏳ เหลืออีก ${remaining} คิว\n🚶‍♂️ กรุณาเตรียมตัวพร้อม\n\n💡 พิมพ์ "เช็ค" เพื่อดูสถานะล่าสุด`
                }]);
                
                notificationCache.set(`${notificationKey}_near`, Date.now());
                console.log(`⚠️ Sent NEAR notification to ${userId} for queue ${queueNumber} (${remaining} remaining)`);
                return true;
            }
        }
        else if (userQueue < latestCalled) {
            // 🚫 คิวผ่านไปแล้ว
            if (!notificationCache.has(`${notificationKey}_passed`)) {
                await pushMessage(userId, [{
                    type: 'text',
                    text: `🚫 คิวผ่านไปแล้ว!\n\n👤 ${displayName}\n📢 คิว ${queueNumber}\n📍 คิวล่าสุดที่เรียก: ${latestCalled}\n\n💡 กรุณาตรวจสอบที่เคาน์เตอร์ ${counterId}\n🔄 หรือพิมพ์เลขคิวใหม่`
                }]);
                
                notificationCache.set(`${notificationKey}_passed`, Date.now());
                console.log(`🚫 Sent PASSED notification to ${userId} for queue ${queueNumber}`);
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error(`Error checking user ${userId} queue ${queueNumber}:`, error);
        return false;
    }
}

// 💾 Cache สำหรับป้องกันการส่งซ้ำ
const notificationCache = new Map();

// ล้าง cache ทุก 30 นาที
setInterval(() => {
    const now = Date.now();
    for (const [key, timestamp] of notificationCache.entries()) {
        if (now - timestamp > 30 * 60 * 1000) { // 30 minutes
            notificationCache.delete(key);
        }
    }
    console.log(`🧹 Cleaned notification cache. Current size: ${notificationCache.size}`);
}, 30 * 60 * 1000);

// 🌐 API Endpoints

// 1️⃣ API สำหรับระบบคิวเรียกใช้
app.post('/api/notify-queue-updates', async (req, res) => {
    console.log('📡 Queue update notification triggered');
    const result = await checkAndNotifyAllUsers();
    res.json(result);
});

// 2️⃣ API ส่งข้อความแจ้งทั่วไป
app.post('/api/broadcast', async (req, res) => {
    const { message } = req.body;
    
    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    try {
        const { data: users } = await supabase
            .from('line_users')
            .select('line_user_id')
            .eq('is_active', true);

        let sentCount = 0;
        for (const user of users) {
            try {
                await pushMessage(user.line_user_id, [{
                    type: 'text',
                    text: `📢 ประกาศ\n\n${message}\n\n🏢 สำนักงานที่ดิน จ.นครสวรรค์`
                }]);
                sentCount++;
            } catch (error) {
                console.error(`Failed to send broadcast to ${user.line_user_id}`);
            }
        }

        res.json({ success: true, sent: sentCount, total: users.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 3️⃣ API ตรวจสอบสถานะระบบ
app.get('/api/status', async (req, res) => {
    try {
        const { data: totalUsers } = await supabase
            .from('line_users')
            .select('id', { count: 'exact' })
            .eq('is_active', true);

        const { data: trackingUsers } = await supabase
            .from('line_users')
            .select('id', { count: 'exact' })
            .not('tracked_queue', 'is', null)
            .eq('is_active', true);

        res.json({
            status: 'running',
            totalUsers: totalUsers?.length || 0,
            trackingUsers: trackingUsers?.length || 0,
            notificationCacheSize: notificationCache.size,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4️⃣ API ดูรายการผู้ใช้
app.get('/api/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('line_users')
            .select('display_name, tracked_queue, created_at, updated_at')
            .eq('is_active', true)
            .order('updated_at', { ascending: false });

        if (error) throw error;

        res.json({
            success: true,
            users: users.map(user => ({
                name: user.display_name,
                queue: user.tracked_queue,
                joinedAt: user.created_at,
                lastActive: user.updated_at
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 5️⃣ API ทดสอบการส่งข้อความ
app.post('/api/test-notification', async (req, res) => {
    const { userId, message } = req.body;
    
    try {
        await pushMessage(userId, [{
            type: 'text',
            text: message || '🧪 ข้อความทดสอบระบบ\n\nหากเห็นข้อความนี้ แสดงว่าระบบทำงานปกติ!'
        }]);
        
        res.json({ success: true, message: 'Test message sent' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 🔄 ระบบตรวจสอบอัตโนมัติทุก 30 วินาที
setInterval(async () => {
    try {
        const result = await checkAndNotifyAllUsers();
        if (result.success && result.notificationsSent > 0) {
            console.log(`🔔 Auto-check completed: ${result.notificationsSent} notifications sent`);
        }
    } catch (error)
    {
        console.error('❌ Error in auto-check:', error);
    }
}, 30000); // 30 seconds

// 🌐 เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
    console.log(`🚀 Line Notification Server running on port ${PORT}`);
    console.log(`📡 Webhook URL: http://localhost:${PORT}/webhook/line`);
    console.log(`🔔 Auto-notification: Active (every 30 seconds)`);
    console.log(`📊 Status check: http://localhost:${PORT}/api/status`);
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
