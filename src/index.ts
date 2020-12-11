#! /usr/bin/env node
require('module-alias/register');

import { log } from "@lib/log";
import AutomatedQA from "@lib/automatedQA";

(async () => {
  const AutomatedTest = new AutomatedQA(5, 'http://pros-redesign.test/wp-json/wp/v2/pages');
  await AutomatedTest.load();

  //const chromeResults = await AutomatedTest.run('chromium');
  const webkitResults = await AutomatedTest.run('webkit');

  const failures = [...webkitResults.failed];

  if (failures.length > 0) {
    log('\n');
    failures.forEach((failedTest) => {
      log(`${failedTest.browser} - ${failedTest.url} FAILED`);
    });
    log(`Automated QA testing yielded ${failures.length} failing tests.`);
  } else {
    log('\n');
    log(`Automated QA testing yielded ${(AutomatedTest.getUrlCount() * 2)} passed tests.`);
  }

  const time = parseFloat(webkitResults.time); //+ parseFloat(webkitResults.time);

  log(`Test finished in ${time.toFixed(3)} seconds.`)

  await AutomatedTest.writeManifest();

})();

