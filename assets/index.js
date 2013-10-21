
// main client-side script

var request = require('superagent')
  , angular = require('angularjs')
  , settings = require('settings')('familyfound')
  , angularSettings = require('angular-settings')
  , breadcrumb = require('breadcrumb')
  , dialog = require('dialog')
  , svgDownload = require('svg-download')
  , fan = require('fan')

  , defaultSettings = require('./settings')
  , app = require('./angular')
  , pages = require('./pages')
  , oauth = require('./oauth');

settings.config(defaultSettings);

require('settings')().set('ffapi.cache', 'session');

// require('settings')().set('ffapi.main.ffhome', '/'); // don't need external url

function showError(err) {
  console.error(err);
  dialog('Page Error', 'Sorry, an error occurred on the page. Please refresh.')
    .addClass('error-modal')
    .modal()
    .show();
}

function toCamelCase(title) {
  return title[0].toLowerCase() + title.slice(1);
}

var loadPeople = function (get, base, scope, gens, root) {
  if (gens <= 0) {
    base.hideParents = true;
    return null;
  }
  base.hideParents = false;
  if (base.fatherId) {
    get(base.fatherId, function (data, cached) {
        base.father = data;
        loadPeople(get, base.father, scope, gens - 1);
        if (!cached) scope.$digest();
      });
  }
  if (base.motherId) {
    get(base.motherId, function (data, cached) {
        base.mother = data;
        loadPeople(get, base.mother, scope, gens - 1);
        if (!cached) scope.$digest();
      });
  }
  if (root && 'object' === typeof base.familyIds) {
    Object.keys(base.familyIds).forEach(function (spouseId) {
      if (!base.families[spouseId]) base.families[spouseId] = [null];
      for (var i=0; i<base.familyIds[spouseId].length; i++) {
        base.families[spouseId].push(null);
        get(base.familyIds[spouseId][i], function (i, data, cached) {
          base.families[spouseId][i] = data;
          if (!cached) scope.$digest();
        }.bind(null, i));
      }
    });
  }
};

app.controller('NavController', function ($scope, $location) {
  $scope.activeItem = function (item) {
    var path = $location.path();
    if (item.path === path) return true;
    if (item.match && path.indexOf(item.path) === 0) {
      return true;
    }
    return false;
  };
  $scope.subNav = pages.subNav;
});

function storeKey(pid) {
  return 'breadcrumb.' + pid;
}

function getHistory(pid) {
  console.log('getting for pid', pid);
  var key = storeKey(pid);
  if (localStorage[key]) {
    try {
      return JSON.parse(localStorage[key]);
    } catch (e) {}
  }
  return [];
}

function setHistory(pid, history) {
  console.log('setting for pid', pid, history.length);
  var key = storeKey(pid);
  localStorage[key] = JSON.stringify(history);
}

var helpText = "<b>Inactive:</b> Research has not yet begun.<br>" +
  "<b>Active:</b> Research is in progress.<br>" +
  "<b>Clean:</b> Duplicates have been resolved and existing data has been checked for reasonableness.<br>" +
  "<b>Complete:</b> All data is found, sources have been attached, etc.";

var mainControllers = {

  TodoView: function ($scope, $route, $location, user, ffapi) {
    $scope.removeTodo = function (todo) {
      var i = $scope.todos.owned.indexOf(todo);
      if (i === -1) {
        console.warn('trying to remove unknown todo', todo);
        return;
      }
      $scope.todos.owned.splice(i, 1);
      ffapi('todos/remove', {id: todo._id});
      $scope.$digest();
    };

    $scope.loadingTodos = true;
    user(function(user) {
      var personId = $route.current.params.id || user.personId;
      request.get('/api/todos/list')
        .end(function (err, req) {
          $scope.loadingTodos = false;
          if (err) return console.error('Failed to get todos');
          if (req.status == 401) {
            console.error('Not authorized....');
            return window.location.reload();
          }
          $scope.todos = req.body;
          $scope.todos.owned.forEach(function (todo) {
            todo.owned = true;
            todo.watching = false;
            todo.done = !!todo.completed;
          });
          $scope.todos.watching.forEach(function (todo) {
            todo.owned = false;
            todo.watching = true;
            todo.done = !!todo.completed;
          });
          $scope.$digest();
        });
      request.get('/api/alerts/list')
        .end(function (err, req) {
          if (err) return console.error('Failed to get alerts');
          $scope.alerts = req.body;
          $scope.$digest();
        });
    });
  },

  PhotosView: function ($scope, $route, $location, $compile, user, ffapi) {
    $scope.loadingPeople = 1;
    user(function(user) {
      var personId = $route.current.params.id || user.personId;
      console.log('getting for', personId);
      $scope.history = getHistory(personId);
      var get = function (pid, next) {
        $scope.loadingPeople++;
        ffapi.relation(pid, function (person, cached) {
          $scope.loadingPeople--;
          next(person, cached);
        });
      };
      ffapi.relation(personId, function (person, cached) {
        $scope.rootPerson = person;
        $scope.loadingPeople--;
        loadPeople(get, person, $scope, settings.get('main.displayGens')  - 1, true);
        if (!cached) $scope.$digest();
      });
    });
  },

  PersonView: function ($scope, $route, $location, $compile, user, ffapi) {
    $scope.rootPerson = null;

    // Breadcrumbs
    $scope.bcConfig = {front:20, back: 20};
    $scope.history = [];

    function navigate(person, direction) {
      console.log('navigate', person.id, $scope.rootPerson.id);
      $scope.history.push({
        id: $scope.rootPerson.id,
        // add in date range here?
        name: $scope.rootPerson.display.name + ' (' + $scope.rootPerson.display.lifespan + ')',
        direction: direction
      });
      setHistory(person.id, $scope.history);
      // window.location.hash = '#view=ancestor&person=' + person.id;
      $location.path('/person/' + person.id);
      $scope.$root.$digest();
      // $scope.$digest();
    }

    $scope.clearCache = function () {
      ffapi.clear();
      location.refresh();
    };

    $scope.printConfig = {
      printable: true,
      gens: settings.get('main.displayGens'),
      links: false,
      families: false,
      width: 1200,
      height: 900,
      center: {x: 600, y: 600},
      ringWidth: 40,
      doubleWidth: true,
      tips: false
    };
    $scope.fanConfig = {
      gens: settings.get('main.displayGens'),
      links: false,
      width: 800,
      height: 600,
      center: {x: 400, y: 400},
      ringWidth: 35,
      doubleWidth: false,
      indicators: true,
      tips: function (person) {
        var message = '<span class="name">' + person.display.name + '</span> ' +
                      '<span class="life">' + person.display.lifespan + '</span>';
        if (person.display.birthPlace &&
            person.display.deathPlace &&
            person.display.birthPlace.toLowerCase() === person.display.deathPlace.toLowerCase()) {
          message += '<br><span class="born-died"><span class="title">Born and Died:</span> ' +
                     person.display.birthPlace + '</span>';
        } else {
          if (person.display.birthPlace) {
            message += '<br><span class="born"><span class="title">Born:</span> ' +
                       person.display.birthPlace + '</span>';
          }
          if (person.display.deathPlace) {
            message += '<br><span class="died"><span class="title">Died:</span> ' +
                       person.display.deathPlace + '</span>';
          }
        }
        var kids = 0;
        for (var spouse in person.familyIds) {
          // list starts w/ the id of the spouse
          kids += person.familyIds[spouse].length - 1;
        }
        var kidsClass = kids === 1 ? 'one-child' : (kids < 4 ? 'few-children' : '')
        message += '<br><span class="children ' + kidsClass + '">' +
                   kids + ' ' + (kids === 1 ? 'child' : 'children') + '</span>';
        return message;
      },
      onSpouse: function (el, person) {
        el.on('click', function () {
          navigate(person, 'side');
        });
      },
      onChild: function (el, person) {
        el.on('click', function () {
          navigate(person, 'down');
        });
      },
      onParent: function (el, person, node) {
        el.on('click', function () {
          navigate(person, 'up');
        });
        var kids = 0;
        for (var spouse in person.familyIds) {
          // list starts w/ the id of the spouse
          kids += person.familyIds[spouse].length - 1;
        }
        var kidsClass = kids === 1 ? 'one-child' : (kids < 4 ? 'few-children' : '');
        if (kidsClass && !(person.display.lifespan && person.display.lifespan.match(/Living/i))) {
          node.indicators[0].classed(kidsClass, true);
        }
      },
      onNode: function (el, person) {
        el.on('click', function () {
          $location.path('/person/' + person.id);
          $scope.$root.$digest();
        });
      }
    };
    /*
    $scope.photosConfig = {
      gens: 7,
      height: 1220,
      width: 1220,
      sweep: Math.PI*2,
      photos: true,
      center: {x: 610, y: 610},
      families: false,
      svgtips: true,
      printable: true,
      doubleWidth: false,
      ringWidth: 85,
      links: false,
      onSpouse: function (el, person) {
        el.on('click', function () {
          navigate(person, 'side');
        });
      },
      onChild: function (el, person) {
        el.on('click', function () {
          navigate(person, 'down');
        });
      },
      onParent: function (el, person, node) {
        el.on('click', function () {
          navigate(person, 'up');
        });
        if (node.photo) {
          node.photo.on('click', function () {
            navigate(person, 'up');
          });
        }
      }
    };
    */
    /*
    $scope.photosSvg = '#';
    $scope.downloadPhotos = function ($event) {
      if ($scope.loadingPeople > 0) {
        console.log('still loading', $scope.loadingPeople);
        return;
      }
      var svg = document.getElementById('photos-tree').firstElementChild;
      $event.target.href = svgDownload('Family Tree Photos: ' + $scope.rootPerson.display.name, svg, fan.stylesheet);
    };
    */
    $scope.downloadFan = function ($event) {
      if ($scope.loadingPeople > 0) {
        console.log('still loading', $scope.loadingPeople);
        return;
      }
      var svg = document.getElementById('download-tree').firstElementChild;
      $event.target.href = svgDownload('Family Tree: ' + $scope.rootPerson.display.name, svg, fan.stylesheet);
    };
    $scope.loadingPeople = 1;
    user(function(user) {
      var personId = $route.current.params.id || user.personId;
      console.log('getting for', personId);
      $scope.history = getHistory(personId);
      /*
      function getPhoto(pid, person) {
        ffapi.photo(pid, function (photo, cached) {
          person.photo = photo.thumbSquareUrl;
          person.photolink = 'https://familysearch.org/tree/#view=ancestor&person=' + pid;
          // if (!cached) $scope.$digest();
        });
      }
      */
      var get = function (pid, next) {
        $scope.loadingPeople++;
        ffapi.relation(pid, function (person, cached) {
          $scope.loadingPeople--;
          // getPhoto(pid, person);
          next(person, cached);
        });
      };
      ffapi.relation(personId, function (person, cached) {
        $scope.rootPerson = person;
        $scope.loadingPeople--;
        // getPhoto(personId, person);
        loadPeople(get, person, $scope, settings.get('main.displayGens')  - 1, true);
        if (!cached) $scope.$digest();
      });
    });
  }

};

for (var key in pages.routes) {
  app.addRoute(key,
               toCamelCase(pages.routes[key]) + '.html',
               mainControllers[pages.routes[key]]);
}

app.run(function () {
});
