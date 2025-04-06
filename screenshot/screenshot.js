const puppeteer = require('puppeteer');

const url = process.env.SCREENSHOT_URL ?? "http://dorianko.ch/embed_gym?hidecontrols=1";
if(!process.env.SCREENSHOT_URL) {
    console.log("No URL provided, using default URL: " + url);
}

async function takeScreenshot() {
    console.log("Starting puppeteer...");
    // Launch browser with specific configurations for running in Docker
    const browser = await puppeteer.launch({
        executablePath: '/usr/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=900,530'
        ],
        headless: 'new',
        defaultViewport: {
            width: 900,
            height: 530
        }
    });

    try {
        const page = await browser.newPage();
        console.log("Opened page");
        // Set additional timeout and wait conditions
        await page.setDefaultNavigationTimeout(30000);
        await page.setDefaultTimeout(30000);
        
        // Set viewport size (adjust as needed)
        await page.setViewport({
            width: 900,
            height: 530, 
        });
        let wantedTimezone = 'Europe/Berlin';
        if (process.env.TZ && process.env.TZ !== '') {
            wantedTimezone = process.env.TZ;
        }
        await page.emulateTimezone(wantedTimezone);

        // Navigate to your website
        await page.goto(url, {
            waitUntil: ['networkidle0', 'domcontentloaded'], // Wait until network is idle
            timeout: 10000, // 10 seconds timeout
        });
        console.log("Navigated to page");

        await page.waitForSelector("#gymchart", {timeout: 10000});
        console.log("Found selector");
        // Take screenshot
        await page.screenshot({
            path: '/data/screenshot.png',
            type: 'png'
        });

        console.log('Screenshot taken successfully!');
    } catch (error) {
        console.error('Error taking screenshot:', error);
    } finally {
        await browser.close();
    }
}

takeScreenshot();