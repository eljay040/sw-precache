'use strict';

var gulp = require('gulp');
var $ = require('gulp-load-plugins')({pattern: '*'});
var crypto = require('crypto');
var fs = require('fs');

// This provides a safegaurd against accidentally precaching a very large file. It can be tweaked.
var MAXIMUM_CACHE_SIZE_IN_BYTES = 2 * 1024 * 1024; // 2MB

var DEV_DIR = 'app';
var DIST_DIR = 'dist';
var SERVICE_WORKER_HELPERS_DEV_DIR = DEV_DIR + '/service-worker-helpers';

function getFilesAndSizesAndHashesForGlobPattern(globPattern) {
  var filesAndSizesAndHashes = [];

  // It would be nicer to do this with a filter()/map() combo, but then we'd need to stat
  // each file twice.
  $.glob.sync(globPattern).forEach(function(file) {
    var stat = fs.statSync(file);
    if (stat.isFile()) {
      var buffer = fs.readFileSync(file);
      filesAndSizesAndHashes.push({
        file: file,
        size: stat.size,
        hash: getHash(buffer)
      });
    }
  });

  return filesAndSizesAndHashes;
}

function getHash(data) {
  var md5 = crypto.createHash('md5');
  md5.update(data);

  return md5.digest('hex');
}

gulp.task('default', ['serve-dist']);

gulp.task('build', function() {
  $.runSequence('copy-service-worker-files', 'copy-dev-to-dist', 'generate-service-worker-js');
});

gulp.task('clean', function() {
  $.del([DIST_DIR, SERVICE_WORKER_HELPERS_DEV_DIR]);
});

gulp.task('serve-dev', ['copy-service-worker-files'], function() {
  $.browserSync({
    notify: false,
    server: DEV_DIR
  });

  gulp.watch(DEV_DIR + '/**', $.browserSync.reload);
});

gulp.task('serve-dist', ['build'], function() {
  $.browserSync({
    notify: false,
    server: DIST_DIR
  });
});

gulp.task('generate-service-worker-js', function() {
  // Specify as many glob patterns as needed to indentify all the files that need to be cached.
  // If the same file is picked up by multiple patterns, it will only be cached once.
  var globPatterns = [
    DIST_DIR + '/css/**.css',
    DIST_DIR + '/**.html',
    DIST_DIR + '/images/**.*',
    DIST_DIR + '/js/**.js'
  ];

  var relativeUrlToHash = {};
  var cumulativeSize = 0;
  globPatterns.forEach(function(globPattern) {
    var filesAndSizesAndHashes = getFilesAndSizesAndHashesForGlobPattern(globPattern);

    // The files returned from glob are sorted by default, so we don't need to sort here.
    filesAndSizesAndHashes.forEach(function(fileAndSizeAndHash) {
      if (fileAndSizeAndHash.size <= MAXIMUM_CACHE_SIZE_IN_BYTES) {
        // Strip the prefix to turn this into a URL relative to DIST_DIR.
        var relativeUrl = fileAndSizeAndHash.file.replace(DIST_DIR + '/', '');
        relativeUrlToHash[relativeUrl] = fileAndSizeAndHash.hash;

        $.util.log('  Added', fileAndSizeAndHash.file, '-', fileAndSizeAndHash.size, 'bytes');
        cumulativeSize += fileAndSizeAndHash.size;
      } else {
        $.util.log('  Skipped', fileAndSizeAndHash.file, '-', fileAndSizeAndHash.size, 'bytes');
      }
    });
  });

  $.util.log('Total precache size:', Math.round(cumulativeSize / 1024), 'KB');

  // It's very important that running this operation multiple times with the same input files
  // produces identical output, since we need the generated service-worker.js file to change iff
  // the input files changes. The service worker update algorithm,
  // https://slightlyoff.github.io/ServiceWorker/spec/service_worker/index.html#update-algorithm,
  // relies on detecting even a single byte change in service-worker.js to trigger an update.
  // Because of this, we write out the cache options as a series of sorted, nested arrays rather
  // than as objects whose serialized key ordering might vary.
  var cacheOptions = Object.keys(relativeUrlToHash).sort().map(function(relativeUrl) {
    return [relativeUrl, relativeUrlToHash[relativeUrl]];
  });

  // TODO: I'm SURE there's a better way of inserting serialized JavaScript into a file than
  // calling JSON.stringify() and throwing it into a lo-dash template.
  return gulp.src('service-worker-helpers/service-worker.tmpl')
    .pipe($.template({cacheOptions: JSON.stringify(cacheOptions)}))
    .pipe($.rename('service-worker.js'))
    .pipe(gulp.dest(DIST_DIR));
});

gulp.task('copy-dev-to-dist', function() {
  return gulp.src(DEV_DIR + '/**')
    .pipe(gulp.dest(DIST_DIR));
});

gulp.task('copy-service-worker-files', function() {
  return gulp.src('service-worker-helpers/*.js')
    .pipe(gulp.dest(SERVICE_WORKER_HELPERS_DEV_DIR));
});
