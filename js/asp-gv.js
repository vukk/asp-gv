/*
 * ASP-GV javascript package
 *
 * Requires vis.js, jQuery and underscore/lodash, which are passed in to the
 * closure. Also requires jquery.timer.js, which should be loaded before this
 * script loaded.
 *
 * Warning: this script was created in a short amount of time. While some
 * solutions were given proper thought, most of them were just solved with the
 * first solution that popped into my head. Don't expect the whole to be
 * coherent.
 *
 * Warning: this script does not do error handling well. Your browser's
 * javascript development console ("devtools") is a great help for debugging
 * if something does not work. At least Chrome/Chromium and Firefox have these
 * tools built-in.
 *
 * Note: this script fetches JSON objects with a HTTP request. Due to security
 * considerations, this works only if the JSON files are available at the same
 * domain as the script is running in. Ie. if you run this at localhost, serve
 * the JSON files from localhost too.
 * This problem COULD be fixed by using JSONP, but this would require changes
 * to the scripts that output the JSON data.
 *
 * Note on the canvas resizing script:
 * Sometimes the canvas is the correct size, but is still the scrollbars
 * appear. Use CSS to forcibly hide the overflow and thus the scrollbars:
 * html,body {
 *   overflow: hidden;
 * }
 * In some cases "display: block;" is also required.
 *
 * Example on replacing the free height calculation function, using jQuery:
 * aspgv.calculateFreeHeight = function() {
 *     return window.innerHeight
 *         - $('#nav-main').height()
 *         - $('#nav-second').height()
 *         - 4; // NOTE: 4 pixel hack fix.
 * };
 * If the used height is static, ie. your UI elements have static height, then
 * you can just use aspgv.usedHeight = <used height>;
 * Example: aspgv.usedHeight = $('#nav-main-static').height();
 *
 * TODO:
 * - timing and solution JSONs could be combined
 *   - require only times and solutions, eg. optimums should be optional
 * - jslint
 * - use JSONP to avoid same origin policy problems
 * - could add a callback "init finished", where the user has to call startVis
 */

var aspgv = (function (vis, $, _) {
    var me = {};

    // TODO: Not all of these need to be public...
    me.jsonData  = null;
    me.jsonTime  = null;
    me.jsonSoln  = null;
    me.nodes     = new vis.DataSet();
    me.edges     = new vis.DataSet();
    me.allEdges  = new vis.DataSet();
    me.rootNum   = 1;
    me.graph     = null;
    me.times     = null;
    me.solutions = null;
    me.physicsOptions = null;
    me.canvasDiv = null;
    me.canvas    = null;
    me.context   = null;
    // Note that you might have to override the height and width calculation.
    // Either use aspgv.usedHeight = y; aspgv.usedWidth = x; or override the
    // functions aspgv.calculateFreeHeight and asp.calculateFreeWidth yourself.
    // This can be done from outside this script.
    // Just say aspgv.calculateFreeHeight = function () { // calc }
    // See example from above.
    me.freeHeight = window.innerHeight;
    me.freeWidth  = window.innerWidth;
    me.usedHeight = 0;
    me.usedWidth  = 0;
    // 
    me.calculateFreeHeight = function () {
        return window.innerHeight - me.usedHeight;
    };
    me.calculateFreeWidth = function () {
        return window.innerWidth - me.usedWidth;
    };
    // Set true by aspgv.debugCanvasSize = true; to debug canvas size
    me.debugCanvasSize = false;
    // Current status
    me.status = {
        step: 0,
        optimum: 0,
        numSteps: 0,
        timeout: 'N/A',
    };
    // Modify eg .aspgv.springLengths.yellow = 2200;
    me.springLengths = {
        yellow: 25,
        orange: 25,
        red: 25,
        black: 25,
        green: 25
    };
    //
    me.continuePlay = true;
    // Timer stuff
    me.timer = null;
    // set timerUpdateCallback to a function if needed
    // eg.
    // $element = $('#timer-textbox');
    // aspgv.timerUpdateCallback = function (time) {
    //     $element.value = time;
    // };
    me.timerUpdateCallback = false;
    //
    me.timerCurrentTime = null;
    me.timerDecrement = 90;
    me.timerNextAction = function () {};
    //
    me.beforeStepCallback = false;
    me.afterStepCallback = false;

    me.takeNthRoot = function (x, n) {
        try {
            var negate = n % 2 == 1 && x < 0;
            if(negate)
                x = -x;
            var possible = Math.pow(x, 1 / n);
            n = Math.pow(possible, n);
            if(Math.abs(x - n) < 1 && (x > 0 == n > 0))
                return negate ? -possible : possible;
        } catch(e){}
    };
    
    me.init = function (
        visjsCanvasDivId,
        jsonDataURL,
        jsonTimeURL,
        jsonSolnURL,
        rootNum,
        beforeStepCallback,
        afterStepCallback,
        disableResizeScript
    ) {
        // Fetch the div
        me.canvasDiv = document.getElementById(visjsCanvasDivId);
        // Save root number
        me.rootNum = rootNum;
        // Launch requests
        var requests = [];
        requests.push( $.getJSON(jsonDataURL) );
        requests.push( $.getJSON(jsonTimeURL) );
        requests.push( $.getJSON(jsonSolnURL) );

        // Collect results
        $.when.apply($, requests).done(function () {
            // This function is called with three arguments
            me.jsonData = arguments[0][0];
            me.jsonTime = arguments[1][0];
            me.jsonSoln = arguments[2][0];
            if (_.size(me.jsonTime) !== _.size(me.jsonSoln)) {
                $.error('Timing and solution objects have different length.')
            }
        }).done(function () {

            // Data
            me.assignData();
            me.preprocessData();

            // 
            me.status.numSteps = _.size(me.times);
            // Create an array from the solutions, instead of an object
            var solnKeys = Object.keys(me.solutions)
                .map(
                    function (i) { return parseInt(i); }
                )
                .sort(
                    function (a,b) { return a - b; }
                );
            me.solutionArray = [];
            $.each(solnKeys, function () {
                me.solutionArray.push(me.solutions[this]);
            });


            // Create the graph
            me.createVisjsGraph();

            // Start the resizing script
            if (disableResizeScript !== true) {
                me.startCanvasAutoResizing();
            }

            // Save callbacks
            me.beforeStepCallback = beforeStepCallback;
            me.afterStepCallback = afterStepCallback;

            me.startVisualization();
            });
    };

    me.assignData = function () {
        me.times = me.jsonTime;
        me.solutions = me.jsonSoln;
        me.allEdges.add(
            me.jsonData.edges.map(function (e) {
                e.origWidth = e.width;
                e.width = me.takeNthRoot(e.width, me.rootNum);
                return e;
            })
        );
        me.nodes.add(me.jsonData.nodes);
    };

    me.preprocessData = function () {
        // Pad solutions and times, hacky
        var solnLength = Object.keys(me.solutions).length;
        me.solutions[solnLength+1] = me.solutions[solnLength];
        me.solutions[solnLength+2] = me.solutions[solnLength];
        me.solutions[solnLength+3] = me.solutions[solnLength];
        me.times[solnLength+1] = [3.0, me.times[solnLength][1]];
        me.times[solnLength+2] = [3.0, me.times[solnLength][1]];
        me.times[solnLength+3] = [3.0, me.times[solnLength][1]];
        // Normalize coordinates so they are around the origin
        var sumX = 0;
        var sumY = 0;
        var numNodes = _.size(me.nodes.getIds())
        for ( var i = 1; i <= numNodes; i++) {
            sumX += me.nodes.get(i).x;
            sumY += me.nodes.get(i).y;
        }
        var moveX = sumX/numNodes;
        var moveY = sumY/numNodes;
        for ( var i = 1; i <= numNodes; i++) {
            node = me.nodes.get(i);
            me.nodes.update({
                id: i,
                x: node.x - moveX,
                y: node.y - moveY,
            });
        }
        //console.log('normalized X coords by ', moveX, 'Y coords by ', moveY);
    };

    // You can configure physics by setting aspgv.physicsOptions = { //... }
    me.createVisjsGraph = function () {
        var physOpt = null;
        if (me.physicsOptions) {
            physOpt = me.physicsOptions;
        }
        else {
            physOpt = {
                barnesHut: {
                    gravitationalConstant: -5000,
                    centralGravity: 0.1,
                    springConstant: 0.01,
                    springLength: 25,
                }
            }
        }
        var data = { nodes: me.nodes, edges: me.edges };
        var options = {
            nodes: {
                mass: 5,
            },
            edges: {},
            color: {
                hilight: "#ec5148",
            },
            widthSelectionMultiplier: 1.0,
            arrowScaleFactor: 0.7,
            allowedToMoveX: true,
            allowedToMoveY: true,
            physics: physOpt,
            stabilize: false,
            stabilizationIterations: 2000,
        };

        me.graph    = new vis.Graph(me.canvasDiv, data, options);
        me.canvas   = me.canvasDiv.firstChild.firstChild;
        me.context  = me.canvas.getContext('2d');
    };

    me.startCanvasAutoResizing = function () {
        // Register an event listener to call the resizeCanvas() function each
        // time the window is resized.
        window.addEventListener('resize', me.resizeCanvas, false);
        // Resize for the first time
        me.resizeCanvas();
    };

    me.resizeCanvas = function () {
        // Recalculate
        me.freeHeight = me.calculateFreeHeight();
        me.freeWidth = me.calculateFreeWidth();
        // Set
        me.canvas.width = me.freeWidth;
        me.canvas.height = me.freeHeight;
        $(me.canvasDiv).height(me.freeHeight);
        $(me.canvasDiv).width(me.freeWidth);

        //console.log('width', me.freeWidth, 'height', me.freeHeight);
        if (me.debugCanvasSize) {
            me.drawCanvasRectangle();
        }
    };

    me.drawCanvasRectangle = function () {
        me.context.strokeStyle = 'red'; //'tomato';
        me.context.lineWidth = '1';
        me.context.strokeRect(0, 0, me.freeWidth, me.freeHeight);
    };

    me.startVisualization = function () {
        me.drawStep(1);
    };

    // This is not exactly an optimized function.
    // I chose to do it this way, so I don't have to write any undo/redo
    // patterns etc. Implementing the controls is easy, since this function can
    // calculate ANY step n, despite what the previous step was.
    me.drawStep = function (stepNum) {
        if (me.beforeStepCallback) {
            me.beforeStepCallback(stepNum, me);
        }


        // Current edge id:s
        var curEdges = me.edges.getIds()
            .map(function (x) { return parseInt(x) });
        var recentSets = me.solutionArray.slice(
            // array indexing is from 0, step indexing is basically from 1
            // array slice lower range is inclusive
            // array slice upper range is exclusive, not inclusive, so +1
            Math.min(Math.max(stepNum-1-3, 0), me.status.numSteps-1),
            Math.min(Math.max(stepNum-1+1, 0), me.status.numSteps-1+1)
        )
        var recentEdges = _.unique(_.flatten(recentSets));

        me.status.step = stepNum;
        me.status.optimum = me.times[stepNum][1];
        me.status.set = me.solutions[stepNum];

        //console.log('curEdges', curEdges);
        //console.log('recentEdges', recentEdges);
        //console.log('remove', _.difference(curEdges, recentEdges));
        //console.log('add', _.difference(recentEdges, curEdges));

        // Remove those current edges, that are not in recent solutions.
        $.each(_.difference(curEdges, recentEdges), function () {
            me.edges.remove({id: this});
        });

        // Add those edges, that are in recent solutions but are not in current
        // edges.
        $.each(_.difference(recentEdges, curEdges), function (){
            me.edges.add(me.allEdges.get(this));
        });

        // Recolor and set attributes
        var tmpSet = me.status.set.slice(); // slice to copy array
        // green, new in this set (weren't on the previous set)
        var green = _.difference(
            me.status.set, _.flatten(recentSets.slice(-2, -1))
        );
        // black, were in previous set too
        var black = _.difference(me.status.set, green);
        // red, recently removed, were on the last set but not in this one
        var red = _.difference(
            _.flatten(recentSets.slice(-2, -1)),
            _.flatten(recentSets.slice(-1))
        );
        // orange, were already removed last time, aren't in the new one
        var orange = _.difference(
            _.flatten(recentSets.slice(-3, -2)),
            _.flatten(recentSets.slice(-2))
        );
        // yellow, oldest ones we show...
        var yellow = _.difference(
            _.flatten(recentSets.slice(-4, -3)),
            _.flatten(recentSets.slice(-3))
        );

        //console.log('green', green);
        //console.log('black', black);
        //console.log('red', red);
        //console.log('orange', orange);
        //console.log('yellow', yellow);
        
        $.each(yellow, function () {
            me.edges.update({
                id: this,
                color: "yellow",
                length: me.springLengths['yellow'],
            });
        });
        $.each(orange, function () {
            me.edges.update({
                id: this,
                color: "orange",
                length: me.springLengths['orange'],
            });
        });
        $.each(red, function () {
            me.edges.update({
                id: this,
                color: "red",
                length: me.springLengths['red'],
            });
        });
        $.each(black, function () {
            me.edges.update({
                id: this,
                color: "black",
                length: me.springLengths['black'],
            });
        });
        $.each(green, function () {
            me.edges.update({
                id: this,
                color: "green",
                length: me.springLengths['green'],
            });
        });


       

        // Set up next step
        if (stepNum < me.status.numSteps) {
            //console.log('wait', me.times[(stepNum+1)-1], 'for step', stepNum+1);
            me.status.timeout = me.times[(stepNum+1)-1][0] * 100;
            me.timerCurrentTime = me.status.timeout;
            me.timerNextAction = function () {
                me.drawStep(stepNum+1);
            };
            me.timer = $.timer(
                function () {
                    me.updateTimer();
                },
                me.timerDecrement,
                false
            );
        }
        if (me.afterStepCallback) {
            me.afterStepCallback(stepNum, me);
        }
        // Call next step
        if (me.continuePlay && stepNum < me.status.numSteps) {
            me.timer.play(true);
        }
    };

    me.updateTimer = function () {
        if (me.timerUpdateCallback)
            me.timerUpdateCallback(me.formatTime(me.timerCurrentTime));

        if (me.timerCurrentTime === 0) {
            me.timer.stop();
            me.timerNextAction();
            return;
        }

        me.timerCurrentTime -= me.timerDecrement/10;

        if (me.timerCurrentTime < 0)
            me.timerCurrentTime = 0;
    };

    me.pad = function (number, length) {
        var str = '' + number;
        while (str.length < length) {str = '0' + str;}
        return str;
    };

    me.formatTime = function (time) {
        var min = parseInt(time / 6000);
        var sec = parseInt(time / 100) - (min * 60);
        var hundredths = me.pad(time - (sec * 100) - (min * 6000), 2);
        // trick: function (float) { return (float | 0) } -> <floored int>
        return (min > 0 ? me.pad(min, 2) : "00") + ":" + me.pad(sec, 2) + ":" + me.pad((hundredths | 0), 2);
    };

    me.play = function () {
        me.continuePlay = true;
        me.timer.play();
        return true;
    };

    me.pause = function () {
        if (me.timer.isActive) {
            me.continuePlay = false;
            me.timer.pause();
            return true;
        }
        return false;
    };

    me.next = function () {
        me.timer.stop();
        if (me.status.step < me.status.numSteps) {
            me.drawStep(me.status.step + 1);
            return true
        }
        return false;
    };

    me.prev = function () {
        me.timer.stop();
        if (me.status.step > 2) {
            me.drawStep(me.status.step - 1);
            return true;
        }
        return false;
    };

    me.first = function () {
        me.timer.stop();
        me.drawStep(1);
        return true;
    };

    me.last = function () {
        me.timer.stop();
        me.drawStep(me.status.numSteps);
        return true;
    };

    return me;
}(vis, jQuery, _));


/* EOF */

