const http = require('http');
const express = require('express');
const multer = require('multer');
const { spawn } = require('child_process');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const UPLOADS_DIR = 'uploads';
const VIDEO_DONE_DIR = 'video_done';
[UPLOADS_DIR, VIDEO_DONE_DIR].forEach(dir => { if (!fs.existsSync(dir)) fs.mkdirSync(dir); });

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });
wss.on('connection', ws => console.log('Клієнт підключився до WebSocket'));

const broadcast = (data) => wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(data));
});

const parseTimeToSeconds = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.match(/(\d+):(\d+):(\d+\.?\d*)/);
    if (!parts) return 0;
    return parseFloat(parts[1]) * 3600 + parseFloat(parts[2]) * 60 + parseFloat(parts[3]);
};

app.use(express.static('public'));
app.use('/video_done', express.static(path.join(__dirname, 'video_done')));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// ЗНАЙДІТЬ ЦЕЙ БЛОК І ЗАМІНІТЬ ЙОГО ПОВНІСТЮ

app.post('/generate', upload.fields([{ name: 'visual', maxCount: 1 }, { name: 'audio' }]), (req, res) => {
    const visualFile = req.files.visual?.[0];
    const audioFiles = req.files.audio || [];
    if (!visualFile || audioFiles.length === 0) return res.status(400).send('Файли не завантажено');
    
    res.status(200).json({ message: 'Генерацію розпочато' });

    (async () => {
        const tempFilePaths = [visualFile.path, ...audioFiles.map(f => f.path)];
        const outputFileName = `playlist_${Date.now()}.mp4`;
        const outputPath = path.resolve(VIDEO_DONE_DIR, outputFileName);
        
        const cleanup = () => tempFilePaths.forEach(p => { if (fs.existsSync(p)) fs.unlinkSync(p); });

        try {
            const durationPromises = audioFiles.map(file => new Promise((resolve, reject) => 
                ffmpeg.ffprobe(file.path, (err, metadata) => err ? reject(err) : resolve(metadata.format.duration))
            ));
            const durations = await Promise.all(durationPromises);
            const totalDuration = durations.reduce((acc, d) => acc + d, 0);

            let args = [];
            const fps = req.body.fps || '30';

            // *** ЗМІНА #1: Ми додаємо спеціальний прапор '-progress -' ***
            // Це наказує ffmpeg надсилати чистий звіт про прогрес в стандартний вивід (stdout)
            args.push('-progress', '-', '-nostats');

            if (visualFile.mimetype === 'image/gif') {
                args.push('-stream_loop', '-1', '-i', path.resolve(visualFile.path));
            } else if (visualFile.mimetype.startsWith('image/')) {
                args.push('-loop', '1', '-r', fps, '-i', path.resolve(visualFile.path));
            } else {
                args.push('-i', path.resolve(visualFile.path));
            }

            audioFiles.forEach(file => {
                args.push('-i', path.resolve(file.path));
            });
            
            const videoFilter = '[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v_out]';
            const audioInputs = audioFiles.map((_, i) => `[${i + 1}:a]`).join('');
            const audioFilter = `${audioInputs}concat=n=${audioFiles.length}:v=0:a=1[a_out]`;
            
            args.push('-filter_complex', `${videoFilter}; ${audioFilter}`);
            
            args.push(
                '-map', '[v_out]', '-map', '[a_out]',
                '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
                '-c:a', 'aac', '-b:a', '192k',
                '-t', totalDuration,
                outputPath
            );
            
            console.log('✅ Запускаю FFmpeg з оновленою командою:', `ffmpeg ${args.join(' ')}`);
            const ffmpegProcess = spawn('ffmpeg', args);

            let stderrOutput = ''; // Ми все ще можемо збирати помилки окремо
            ffmpegProcess.stderr.on('data', (data) => {
                stderrOutput += data.toString();
            });

            // *** ЗМІНА #2: Тепер ми слухаємо stdout, а не stderr, для прогресу ***
            ffmpegProcess.stdout.on('data', (data) => {
                const text = data.toString();
                const outTimeMatch = text.match(/out_time_ms=(\d+)/);
                if (outTimeMatch) {
                    const progressInSeconds = parseInt(outTimeMatch[1], 10) / 1000000;
                    broadcast({ type: 'progress', progress: progressInSeconds, totalDuration });
                }
            });

            ffmpegProcess.on('close', (code) => {
                if (code === 0) {
                    console.log('✅ Процес FFmpeg успішно завершено.');
                    broadcast({ type: 'done', downloadPath: `/${VIDEO_DONE_DIR}/${outputFileName}`, fileName: outputFileName });
                } else {
                    console.error(`❌ FFmpeg завершився з кодом помилки ${code}`);
                    console.error('Потік помилок FFmpeg (stderr):\n', stderrOutput);
                    broadcast({ type: 'error', message: `FFmpeg exited with code ${code}. Details: ${stderrOutput.split('\n').slice(-15).join('\n')}` });
                }
                cleanup();
            });

            ffmpegProcess.on('error', (err) => {
                console.error('❌ Не вдалося запустити процес FFmpeg:', err);
                broadcast({ type: 'error', message: 'Failed to start FFmpeg process.' });
                cleanup();
            });

        } catch (err) {
            console.error('❌ Критична помилка під час налаштування генерації:', err);
            broadcast({ type: 'error', message: err.message });
            cleanup();
        }
    })();
});

// КІНЕЦЬ БЛОКУ ДЛЯ ЗАМІНИ

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Сервер з WebSocket запущено на http://localhost:${PORT}`));
