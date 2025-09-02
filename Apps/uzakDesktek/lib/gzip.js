// Apps/UzakDestek/lib/gzip.js

// Bu dosya, büyük DOM verilerini sıkıştırmak için pako kütüphanesini kullanır.
// Projeye pako'yu dahil etmek yerine, CDN'den dinamik olarak yüklüyoruz.

let pakoInstance = null;

async function getPako() {
    if (pakoInstance) return pakoInstance;
    // Pako kütüphanesini dinamik olarak import et
    const pakoModule = await import('https://cdn.jsdelivr.net/npm/pako@2.1.0/+esm');
    pakoInstance = pakoModule.default;
    return pakoInstance;
}

/**
 * Verilen string'i gzip ile sıkıştırır ve bir ArrayBuffer olarak döndürür.
 * @param {string} data Sıkıştırılacak string veri.
 * @returns {Promise<ArrayBuffer>} Sıkıştırılmış veriyi içeren ArrayBuffer.
 */
export async function gzip(data) {
    const pako = await getPako();
    
    // DÜZELTME: pako.gzip doğrudan bir Uint8Array (binary veri) döndürür.
    // Bunu string gibi işlemeye gerek yok.
    const compressedData = pako.gzip(data);
    
    // WebSocket'in gönderebilmesi için bu Uint8Array'in buffer'ını doğrudan dönebiliriz.
    return compressedData.buffer;
}

/**
 * Gzip ile sıkıştırılmış bir ArrayBuffer'ı açar ve string olarak döndürür.
 * @param {ArrayBuffer} binaryData Sıkıştırılmış veriyi içeren ArrayBuffer.
 * @returns {Promise<string>} Açılmış string veri.
 */
export async function ungzip(binaryData) {
    const pako = await getPako();
    
    // DÜZELTME: Gelen ArrayBuffer zaten pako'nun beklediği formata yakın.
    // Doğrudan bir Uint8Array'e çevirip kullanabiliriz.
    const uint8Array = new Uint8Array(binaryData);
    
    return pako.ungzip(uint8Array, { to: 'string' });
}