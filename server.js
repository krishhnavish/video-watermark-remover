const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
app.use(cors());
app.use(express.static(__dirname));

if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

const upload = multer({ 
    dest: 'uploads/',
    limits: { fieldSize: 25 * 1024 * 1024 } // Allow Base64 AI Mask
});

app.post('/remove-watermark', upload.single('video'), async (req, res) => {
    if (!req.file) return res.status(400).send('Video upload nahi hui!');

    const inputPath = req.file.path;
    const outputPath = path.join('uploads', `cleaned_${Date.now()}.mp4`);
    const mode = req.body.mode || 'fast';

    // 1. AI Mode (Replicate ProPainter API)
    if (mode === 'ai') {
        const apiKey = process.env.REPLICATE_API_TOKEN;
        if (!apiKey) {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            return res.status(400).send('AI Mode ke liye REPLICATE_API_TOKEN set nahi hai. Abhi "Fast Remove (Free)" button use karein!');
        }

        try {
            const Replicate = require('replicate');
            const replicate = new Replicate({ auth: apiKey });

            const videoBase64 = `data:${req.file.mimetype};base64,${fs.readFileSync(inputPath).toString('base64')}`;
            const maskBase64 = req.body.mask;

            const outputUrl = await replicate.run(
                "zsxkib/propainter:190ef343befc8effd7eefb7a1cf19b7b0e8a2011ca2c4ebff773222ff2f7ff46",
                {
                    input: {
                        video: videoBase64,
                        mask: maskBase64,
                        fp16: true
                    }
                }
            );

            // Download AI video and send to user
            const aiRes = await fetch(outputUrl);
            const buffer = Buffer.from(await aiRes.arrayBuffer());
            fs.writeFileSync(outputPath, buffer);

            return res.download(outputPath, 'ai_clean_video.mp4', () => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        } catch (err) {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            return res.status(500).send('AI Error: ' + err.message);
        }
    }

    // 2. Fast Mode (FFmpeg No-Crop Delogo with Auto Border-Protection)
    let x = parseInt(req.body.x) || 2;
    let y = parseInt(req.body.y) || 2;
    let w = parseInt(req.body.w) || 50;
    let h = parseInt(req.body.h) || 50;
    let vidW = parseInt(req.body.vidW) || 1920;
    let vidH = parseInt(req.body.vidH) || 1080;

    // Smart Clamping: Box ko video border se hamesha 2px andar rakhega taaki FFmpeg kabhi crash na ho
    x = Math.max(2, Math.min(x, vidW - 10));
    y = Math.max(2, Math.min(y, vidH - 10));
    if (x + w >= vidW - 2) w = (vidW - 2) - x;
    if (y + h >= vidH - 2) h = (vidH - 2) - y;

    ffmpeg(inputPath)
        .videoFilters(`delogo=x=${x}:y=${y}:w=${w}:h=${h}:show=0`)
        .outputOptions('-c:a copy')
        .save(outputPath)
        .on('end', () => {
            res.download(outputPath, 'clean_video.mp4', () => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            });
        })
        .on('error', (err) => {
            console.error('FFmpeg Error:', err.message);
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            res.status(500).send('FFmpeg Error: ' + err.message);
        });
});

// Works on both Localhost (3000) and Render Live Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Server running! Open: http://localhost:${PORT}/index.html`);
});