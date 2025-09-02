const WebSocket = require('ws');

// Gelişmiş Loglama Fonksiyonu
const createLogger = (source) => {
    const log = (level, message, ...data) => {
        const timestamp = new Date().toISOString();
        // Gelen veriyi daha okunabilir hale getirmek için JSON.stringify kullan
        const formattedData = data.map(d => {
            if (d instanceof Buffer) {
                return `Buffer <${d.toString('hex', 0, 20)}...>`;
            }
            if (typeof d === 'object' && d !== null) {
                // WebSocket nesneleri gibi döngüsel referans içerenleri basitleştir
                if (d.constructor.name === 'WebSocket') {
                    return `WebSocket <sessionId: ${d.sessionId || 'yok'}>`;
                }
                try {
                    // Buffer içeren nesneleri düzgün loglamak için replacer kullan
                    const replacer = (key, value) => {
                        if (typeof value === 'object' && value !== null && value.type === 'Buffer' && Array.isArray(value.data)) {
                            return `Buffer <${Buffer.from(value.data).toString('hex', 0, 20)}...>`;
                        }
                        return value;
                    };
                    return JSON.stringify(d, replacer, 2);
                } catch {
                    return '[Unserializable Object]';
                }
            }
            return d;
        }).join(' ');
        console.log(`[${timestamp}] [${source}] [${level.toUpperCase()}] ${message}`, formattedData);
    };
    return {
        info: (message, ...data) => log('info', message, ...data),
        error: (message, ...data) => log('error', message, ...data),
        debug: (message, ...data) => log('debug', message, ...data),
    };
};

const logger = createLogger('SERVER');
const wss = new WebSocket.Server({ port: 8080, host: '0.0.0.0' });
const sessions = new Map();

logger.info(`✅ Uzak Destek Relay Sunucusu başlatıldı. Port: 8080`);
logger.info('İstemcilerin bağlanması bekleniyor...');

wss.on('connection', ws => {
    logger.info('-> Yeni bir istemci bağlandı.', { remoteAddress: ws._socket.remoteAddress });

    ws.on('message', (message, isBinary) => {
        // Binary mesajlar (sıkıştırılmış DOM gibi) doğrudan yönlendirilir.
        // Bu mesajların içinde 'sessionId' veya 'type' gibi alanlar aranmaz.
        // Yönlendirme, bağlantının kendisine atanmış olan ws.sessionId üzerinden yapılır.
        if (isBinary) {
            const sessionId = ws.sessionId;
            const session = sessions.get(sessionId);
            if (session) {
                logger.debug(`Binary mesaj ${sessionId} oturumundaki diğer istemcilere yönlendiriliyor.`);
                session.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(message);
                    }
                });
            } else {
                logger.error('Binary mesaj için oturum bulunamadı, mesaj atlandı.', { sessionId });
            }
            return; // İşlemi burada bitir.
        }

        // Metin tabanlı mesajlar (kontrol ve olay mesajları) burada işlenir.
        let msg;
        try {
            msg = JSON.parse(message.toString('utf8'));
        } catch (e) {
            logger.error('Gelen metin mesajı parse edilemedi:', { error: e.message, data: message.toString('utf8') });
            return;
        }

        logger.debug('Gelen metin mesajı işlendi:', msg);

        switch (msg.type) {
            case 'create-session':
                const newSessionId = `session-${Math.random().toString(36).substr(2, 9)}`;
                sessions.set(newSessionId, new Set([ws]));
                ws.sessionId = newSessionId; // WebSocket nesnesine oturum ID'sini ata
                ws.send(JSON.stringify({ type: 'session-created', sessionId: newSessionId }));
                logger.info(`Oturum oluşturuldu: ${newSessionId}`);
                break;

            case 'join-session':
                const sessionToJoin = sessions.get(msg.sessionId);
                if (sessionToJoin && sessionToJoin.size < 2) {
                    sessionToJoin.add(ws);
                    ws.sessionId = msg.sessionId; // WebSocket nesnesine oturum ID'sini ata

                    sessionToJoin.forEach(client => {
                        if (client === ws) {
                            client.send(JSON.stringify({ type: 'join-success' }));
                        } else {
                            client.send(JSON.stringify({ type: 'session-joined' }));
                        }
                    });
                    logger.info(`Bir istemci ${msg.sessionId} oturumuna katıldı.`);
                } else {
                    const errorMsg = 'Oturum bulunamadı veya dolu.';
                    ws.send(JSON.stringify({ type: 'error', message: errorMsg }));
                    logger.error(`Katılma başarısız: ${msg.sessionId}`, { reason: errorMsg });
                }
                break;

            default:
                // Diğer tüm metin tabanlı mesajları (örn: event-sync) yönlendir.
                const sessionId = ws.sessionId;
                const sessionForDefault = sessions.get(sessionId);
                if (sessionForDefault) {
                    logger.debug(`'${msg.type}' tipi mesaj ${sessionId} oturumundaki diğer istemcilere yönlendiriliyor.`);
                    sessionForDefault.forEach(client => {
                        if (client !== ws && client.readyState === WebSocket.OPEN) {
                            // Gelen orijinal metin mesajını (Buffer/string) doğrudan gönder
                            client.send(message);
                        }
                    });
                } else {
                    logger.error(`Mesaj yönlendirilemedi: Geçerli bir oturum bulunamadı.`, { sessionId, type: msg.type });
                }
                break;
        }
    });

    ws.on('close', () => {
        const sessionId = ws.sessionId;
        logger.info(`<- Bir istemcinin bağlantısı kesildi.`, { sessionId });
        const session = sessions.get(sessionId);
        if (session) {
            session.delete(ws); // Sadece kapanan istemciyi set'ten çıkar
            if (session.size > 0) {
                // Oturumda hala birileri varsa, onlara haber ver
                session.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'user-disconnected' }));
                        logger.info(`'${sessionId}' oturumundaki diğer kullanıcıya bağlantı kesilme bilgisi gönderildi.`);
                    }
                });
            } else {
                // Oturumda kimse kalmadıysa oturumu haritadan sil
                sessions.delete(sessionId);
                logger.info(`Oturum boşaldı ve kapatıldı: ${sessionId}`);
            }
        }
    });

    ws.on('error', (err) => {
        logger.error('Bir WebSocket hatası oluştu:', { sessionId: ws.sessionId, error: err.message });
    });
});