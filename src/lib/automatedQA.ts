#! /usr/bin/env node
require('module-alias/register');

import path  from 'path';
import { log } from "@lib/log";
import mkdirp from "mkdirp";
import { v4 as uuidv4 } from "uuid";
import { promises as fsp, write } from 'fs';
import axios from 'axios';
import os from 'os';
import { runCLI } from "jest";

interface IUrl {
  id: number,
  link: string,
  slug: string,
};

interface IManifest {
  baseRequestId?: string | undefined,
}

/**
 *
 * @param hrtime
 */
const parseHrtimeToSeconds = (hrtime) => {
  var seconds = (hrtime[0] + (hrtime[1] / 1e9)).toFixed(3);
  return seconds;
}

/**
 *
 * @param browser
 */
const getTemplateIndex = (browser) => {
  switch (browser) {
    case 'chromium':
      return 0;
    case 'firefox':
      return 1;
    case 'webkit':
      return 2;
  }
}

export default class AutomatedQA {
  private wpEndpoint;
  private misMatchPercentage: number = 0;
  private templates: string[] = [];
  private urls: IUrl[] = [];
  private manifest: IManifest;
  private requestId: string;
  private directories;
  private screenSizes = {
    DESKTOP: { width: 1920, height: 1080 },
    LAPTOP: { width: 1440, height: 900 },
    IPAD: { width: 768, height: 1024 },
    MOBILE: { width: 375, height: 812 },
  };

  constructor (misMatchPercentage = 5, wpEndpoint) {
    this.misMatchPercentage = misMatchPercentage;
    this.wpEndpoint = wpEndpoint;
    this.requestId = uuidv4();

    this.directories = {
      TEST_ROOT: path.resolve('tests'),
      SCAN_ROOT: path.resolve('scans', this.requestId),
      DESKTOP: path.resolve('scans', this.requestId, 'desktop'),
      LAPTOP: path.resolve('scans', this.requestId, 'laptop'),
      MOBILE: path.resolve('scans', this.requestId, 'mobile'),
    };
  }

  load = async () => {
    log(`Beginning automated QA request ${this.requestId}.`);
    Object.keys(this.directories).forEach((key) => mkdirp(this.directories[key]));

    await this.getManifest();
    await this.getTemplates();
    await this.getUrls();
    log(`Found ${this.urls.length} URLs to test.`);

    const numCores = os.cpus().length;
    log(`Utilizing ${numCores - 1} cores.`);

    return true;
  }

  getUrlCount = (): number => this.urls.length;

  /**
   *
   * @param page
   */
  getUrls = async (page = 1): Promise<Boolean> =>
    new Promise((resolve, reject) => {
      (async () => {
        log('Scanning website for URLs to test against.');
        const apiUrl = this.wpEndpoint;

        try {
          const results = await axios.get(`${apiUrl}?per_page=2&page=${page}`);
          const wpPages = parseInt(results.headers['x-wp-totalpages'], 10);

          this.urls = [...this.urls, ...results.data.map((url) => ({
            id: url.id,
            slug: url.slug,
            link: url.link,
          }))];

          if (wpPages > page) {
            //return getUrls(page + 1);
          }
        } catch (error) {
          reject(error);
        }

        resolve(true);
      })();
    });

  /**
   *
   */
  getTemplates = (): Promise<Boolean> =>
    new Promise((resolve, reject) => {
      (async () => {
        try {
          const chromeTemplate = await fsp.readFile('templates/chromium.base.txt');
          const firefoxTemplate = await fsp.readFile('templates/firefox.base.txt');
          const webkitTemplate = await fsp.readFile('templates/webkit.base.txt');

          this.templates = [
            chromeTemplate.toString(),
            firefoxTemplate.toString(),
            webkitTemplate.toString(),
          ];

          resolve(true);
        } catch (readErrors) {
          reject(readErrors);
        }
      })()
    });

  writeManifest = () =>
    new Promise(async (resolve, reject) => {
      this.manifest.baseRequestId = this.requestId;

      try {
        await fsp.writeFile('scans/manifest.json', JSON.stringify(this.manifest));

        resolve(true);
      } catch (writeError) {
        reject(writeError);
        log('Error writing new manifest file.');
      }
    });

  /**
   *
   */
  getManifest = () =>
    new Promise((resolve) => {
      (async () => {
        log('Searching for existing manifest file.');

        try {
          const manifest = await fsp.readFile(`scans/manifest.json`);
          const data = JSON.parse(manifest.toString());

          this.manifest = data;
          log(`Base Request ID Found: ${this.manifest.baseRequestId}`);

          resolve(true);
        } catch (error) {
          log('No manifest file found. Curating new baseline.');
          this.manifest = {};
          resolve(true);
        }
      })();
    });

  /**
   *
   */
  run = async (browser: string): Promise<any> =>
    new Promise((resolve, reject) => {
      (async () => {
        const startTime = process.hrtime();

        let templateIndex = getTemplateIndex(browser);

        let strData = this.templates[templateIndex];
        this.urls.forEach((url) => {
          strData += `
          it('{"browser":"${browser}","url":"${url.link}"}', async () => {
            await page.goto('${url.link}', { timeout: 0 });
            await page.setViewportSize({ width: ${this.screenSizes.DESKTOP.width}, height: ${this.screenSizes.DESKTOP.height} });
            console.log('here');
            const desktopSS = await page.screenshot({ fullPage: true, quality: 30, type: "jpeg", path: '${this.directories.DESKTOP}/${url.id}/${browser}-snapshot.jpeg' });
            await page.setViewportSize({ width: ${this.screenSizes.LAPTOP.width}, height: ${this.screenSizes.LAPTOP.height} });
            const laptopSS = await page.screenshot({ fullPage: true, quality: 30, type: "jpeg", path: '${this.directories.LAPTOP}/${url.id}/${browser}-snapshot.jpeg' });
            await page.setViewportSize({ width: ${this.screenSizes.MOBILE.width}, height: ${this.screenSizes.MOBILE.height} });
            const mobileSS = await page.screenshot({ fullPage: true, quality: 30, type: "jpeg", path: '${this.directories.MOBILE}/${url.id}/${browser}-snapshot.jpeg' });\n
          `;

          if (this.manifest.baseRequestId) {
            strData += `

            const files = [];
            files.push(
              fsp.readFile("scans/${this.manifest.baseRequestId}/desktop/${url.id}/${browser}-snapshot.jpeg"),
              fsp.readFile("scans/${this.manifest.baseRequestId}/laptop/${url.id}/${browser}-snapshot.jpeg"),
              fsp.readFile("scans/${this.manifest.baseRequestId}/mobile/${url.id}/${browser}-snapshot.jpeg"),
            );

            const fileData = await Promise.all(files);

            const comparisons = [];
            comparisons.push(
              compareImages(desktopSS, fileData[0]),
              compareImages(laptopSS, fileData[1]),
              compareImages(mobileSS, fileData[2]),
            );

            const results = await Promise.all(comparisons);

            results.forEach((result) => {
              const mismatch = parseInt(result.misMatchPercentage, 10);
              console.log(mismatch);
              expect(mismatch).toBeLessThanOrEqual(${this.misMatchPercentage});
            })
            `;
          } else {
            strData += '  expect(1).toBe(1);\n';
          }

          strData += '});\n\n';
        });

        await fsp.writeFile(`tests/${browser}.spec.js`, strData, 'utf8');

        // Add any Jest configuration options here
        const jestConfig = {
          roots: ['./'],
          testRegex: `tests/${browser}.spec.js`,
          testTimeout: 60000,
          maxConcurrency: 8,
          coverage: false,
          coverageReporters: [],
          silent: true,
          verbose: false,
          noStackTrace: true,
          reporters: ["<rootDir>/dist/lib/customReporter"]
        };

        // Run the Jest asynchronously
        let result;
        try {
          result = await runCLI(jestConfig as any, [__dirname]);
        } catch (testErrors) {
          log(`'Failed to run ${browser} tests.`);
        }

        // Analyze the results
        const output = {
          failed: [],
          passed: [],
          time: 0,
        };

        if (!result.results.success) {
          output.failed = result.results.testResults[0].testResults.map((test) => {
            const testData = JSON.parse(test.title);

            return {
              browser: testData.browser,
              url: testData.url,
            };
          });
        }

        output.time = parseHrtimeToSeconds(process.hrtime(startTime));

        resolve(output);
      })();
    });
}
