import fetch from "node-fetch";
import sharp from "sharp";
import { createCanvas } from "canvas";

interface ImagePart {
    width: number;
    height: number;
    data: Buffer;
}

// Function to get an up-to-date picture from a website
async function getUptodatePic(): Promise<sharp.Sharp> {
    const headers = {
        authority: "buchung.hsz.rwth-aachen.de",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "accept-language": "en-US,en-DE;q=0.9,en;q=0.8,de-DE;q=0.7,de;q=0.6",
        "cache-control": "no-cache",
        dnt: "1",
        pragma: "no-cache",
        referer: "https://buchung.hsz.rwth-aachen.de/angebote/aktueller_zeitraum/_Auslastung.html",
        "sec-ch-ua": '"Not.A/Brand";v="8", "Chromium";v="114", "Google Chrome";v="114"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    };
    const params = new URLSearchParams({ size: "30" });
    const response = await fetch("https://buchung.hsz.rwth-aachen.de/cgi/studio.cgi?" + params, {
        headers,
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const buffer = await response.arrayBuffer();
    return sharp(buffer);
}

// Function to split image into parts
async function splitImg(img: sharp.Sharp): Promise<ImagePart[]> {
    let metadata = await img.metadata();
    const parts: ImagePart[] = [];
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    for (let i = 0; i < width; i += 22) {
        const extractWidth = Math.min(22, width - i);
        if (extractWidth <= 0) {
            continue;
        }
        const part = await img
            .clone()
            .extract({
                left: i,
                top: 0,
                width: extractWidth,
                height: height,
            })
            .resize(22, 30, { kernel: sharp.kernel.nearest })
            .toColorspace("b-w")
            .blur(1)
            .toBuffer()
            .catch((error) => {
                console.error("Error during image processing:", error);
                return null;
            });
        if (part) {
            parts.push({ width: 22, height: 30, data: part });
        }
    }
    return parts;
}

// Function to get pictures from filesystem
/*function getPicsFromFs(): Record<string, sharp.Sharp> {
    const pics: Record<string, sharp.Sharp> = {};
    const dir = "./pics";
    fs.readdirSync(dir).forEach((filename) => {
        if (filename.endsWith(".gif")) {
            const image = sharp(path.join(dir, filename));
            pics[filename.split(".")[0]] = image;
        }
    });
    return pics;
}*/

// Function to make a synthetic digit
function makeSyntheticDigit(character: string): sharp.Sharp {
    const canvas = createCanvas(22, 30);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(0, 0, 22, 30);
    ctx.font = "40px Open Sans";
    ctx.fillStyle = "#000000";
    ctx.fillText(character, 0, 30);
    let shar = sharp(canvas.toBuffer());
    // blur
    shar = shar.blur(1);
    return shar;
}

// Function to get synthetic numbers
function getNumbersSynthetic(): Record<number, sharp.Sharp> {
    const list: Record<number, sharp.Sharp> = {};
    for (let i = 0; i < 10; i++) {
        list[i] = makeSyntheticDigit(i.toString());
        // save to disk
        //list[i].toFile(`./pics/${i}.gif`);
    }
    return list;
}

/*async function readNumbersFromPics(): Promise<Record<number, sharp.Sharp>> {
    const pics = getPicsFromFs();
    const numbers: Record<number, sharp.Sharp> = {};

    for (let i = 0; i < 10; i++) {
        for (const [key, image] of Object.entries(pics)) {
            if (key.includes(i.toString())) {
                const parts = await splitImg(image);
                numbers[i] = sharp(parts[0].data); // Simplified: Taking the first match for demonstration
                break;
            }
        }
        if (!(i in numbers)) {
            console.log(`Index ${i} not present`);
        }
    }

    return numbers;
}*/

// Simplified versions of makeDiff and diffVal using sharp

async function diffVal(im1Buffer: Buffer, im2Buffer: Buffer, num: string): Promise<number> {
    const im1 = sharp(im1Buffer);
    const im2 = sharp(im2Buffer);

    const m1 = await im1.metadata();
    const m2 = await im2.metadata();
    if (m1.width != m2.width || m1.height != m2.height) {
        throw new Error("Images must have the same dimensions");
    }

    const diff = await im1
        .composite([
            {
                input: im2Buffer,
                blend: "difference",
            },
        ])
        .raw()
        .toBuffer();
    // save to disk
    /*sharp(diff, { raw: { width: m1.width!, height: m1.height!, channels: 4 } }).toFile(
        `./pics/diff_${num}.gif`
    );*/
    let sum = 0;
    for (let i = 0; i < diff.length; i++) {
        const diffVal = diff[i] / 255;
        sum += diffVal * diffVal;
    }
    return sum;
}

async function matchNumber(
    toBeMatchedBuffer: Buffer,
    numberImages: Record<number, sharp.Sharp>
): Promise<[number, number]> {
    let minDiff = Infinity;
    let matchedNumber = 0;

    //console.log("### Matching Numbers ###");
    for (const [number, image] of Object.entries(numberImages)) {
        const imageBuffer = await image.toBuffer();
        const diff = await diffVal(toBeMatchedBuffer, imageBuffer, number);
        //console.log(`Number: ${number}, Diff: ${diff}`);

        if (diff < minDiff) {
            minDiff = diff;
            matchedNumber = parseInt(number);
        }
    }

    return [matchedNumber, minDiff];
}

async function getAuslastungAndMatchNumbers(): Promise<[number, number][]> {
    let auslastung = await getUptodatePic();
    auslastung = auslastung.toColorspace("b-w");
    // force white background
    auslastung = auslastung.flatten({ background: "#FFFFFF" });
    // save to disk
    //auslastung.toFile("./pics/auslastung.gif");
    const numbers = await getNumbersSynthetic();

    const auslastungParts = await splitImg(auslastung);
    // save to disk
    for (let i = 0; i < auslastungParts.length; i++) {
        //sharp(auslastungParts[i].data).toFile(`./pics/auslastung_${i}.gif`);
    }
    const reconstructedDigits: [number, number][] = [];

    for (const part of auslastungParts) {
        const matched = await matchNumber(part.data, numbers);
        reconstructedDigits.push(matched);
    }

    return reconstructedDigits;
}

export default async function getAuslastungNumber(): Promise<number> {
    const reconstructedDigits = await getAuslastungAndMatchNumbers();
    return parseInt(reconstructedDigits.map((digit) => digit[0].toString()).join(""));
}

/*
(async () => {
    try {
        const auslastungNumber = await getAuslastungNumber();
        console.log(`Auslastung Number: ${auslastungNumber}`);
    } catch (error) {
        console.error("Error:", error);
    }
})();
*/
