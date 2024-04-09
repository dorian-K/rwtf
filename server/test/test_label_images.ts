import sharp from "sharp";
import fs from "fs";
import path from "path";
import { getAuslastungAndMatchNumbers } from "../src/gym_crawler.js";

function getPicsFromFs(): Record<string, sharp.Sharp> {
    const pics: Record<string, sharp.Sharp> = {};
    const dir = "./test_pics";
    fs.readdirSync(dir).forEach((filename) => {
        if (filename.endsWith(".gif")) {
            const image = sharp(path.join(dir, filename));
            pics[filename.split(".")[0]] = image;
        }
    });
    return pics;
}

async function runTest() {
    const pics = getPicsFromFs();
    let failed = 0;

    await Promise.all(
        Object.entries(pics).map(async ([key, image]) => {
            const reconstructedDigits = await getAuslastungAndMatchNumbers(image.clone(), key);
            const classified = parseInt(
                reconstructedDigits.map((digit) => digit[0].toString()).join("")
            );
            console.log(`Expected: ${key}, Classified: ${classified}`);
            /*await image.metadata().then((metadata) => {
                console.log(metadata.width);
            });*/

            if (key !== classified.toString()) {
                console.error("Classification failed!");
                failed++;

                await getAuslastungAndMatchNumbers(image.clone(), key);
            }
        })
    );

    if (failed === 0) {
        console.log("All tests passed.");
    } else {
        throw new Error(`${failed} tests failed.`);
    }
}

runTest();
