const fs = require('fs/promises');
const https = require('https');
const path = require('path');
const { buildSchema } = require('../src/schema/generator');

const OUTPUT_PATH = path.join(__dirname, '..', 'src', 'data', 'cs2-schema.json');

const SOURCE_URLS = {
  itemsGameText: 'https://raw.githubusercontent.com/csfloat/cs-files/master/static/items_game.txt',
  itemsCdnText: 'https://raw.githubusercontent.com/csfloat/cs-files/master/static/items_game_cdn.txt',
  csgoEnglishText: 'https://raw.githubusercontent.com/csfloat/cs-files/master/static/csgo_english.txt',
};

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Request failed for ${url}: ${response.statusCode}`));
        response.resume();
        return;
      }

      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => resolve(raw));
    }).on('error', reject);
  });
}

async function main() {
  const inputs = {};

  for (const [key, url] of Object.entries(SOURCE_URLS)) {
    console.log(`Downloading ${url}`);
    inputs[key] = await download(url);
  }

  const schema = buildSchema(inputs);
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
  console.log(`Wrote schema snapshot to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
