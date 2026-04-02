import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log('Navigating to listing...');
  await page.goto('http://localhost:3002/data/listings/cmhgxnvn80021sba9zgefy07n', {
    waitUntil: 'networkidle2'
  });

  // Wait 3 seconds for images to load
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Take screenshot
  await page.screenshot({ path: '/tmp/listing-page.png', fullPage: true });
  console.log('Screenshot saved to /tmp/listing-page.png');

  // Check image loading status
  const imageStatus = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.map(img => ({
      src: img.src,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight
    }));
  });

  console.log('\nImage Status:');
  imageStatus.forEach((img, i) => {
    console.log(`${i + 1}. ${img.complete ? '✅' : '❌'} ${img.naturalWidth}x${img.naturalHeight} - ${img.src.substring(0, 80)}`);
  });

  await browser.close();
})();
