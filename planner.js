var winston = require('winston'),
	_ = require('lodash'),
	g = require('geometry'),
	bezier = require('./jsBezier').jsBezier;
var logger = new (winston.Logger)({
	transports: [
	  new (winston.transports.Console)(),
	  new (winston.transports.File)({ filename: 'milehigh.log' })
	]
});

var maxTurnDegree = 10;
var radius = {};
var circlePoints = {};
var inLandingZone = {};
var planeToLand;


function calculatePosition(startPos, rotation, speed, time) {
	var distance = speed * time,
		radian = rotation * Math.PI / 180;
	return {
		x: startPos.x - distance * Math.sin(radian),
		y: startPos.y + distance * Math.cos(radian)
	};
}

function calculateDistance(x1, y1, x2, y2) {
	var xd = x1 - x2, yd = y1 - y2;
	return Math.sqrt(xd * xd + yd * yd);
}

function isLandingPossible(plane, runway) {
	var pos = plane.position;
	if (pos.y <= runway.y) {
		if (pos.x <= runway.x && plane.rotation <= 0) {
			return true;
		}
		else if (pos.x > runway.x && plane.rotation > 0) {
			return true;
		}
	}
	return false;
}

function getCircleRadius(plane) {
	var r = plane.speed * 50 / (2 * Math.PI);
	if (radius[r]) {
		r = radius[r] + plane.collision_radius;
	}
	radius[r] = plane.id;
	return r;
}

function calculateCirclePoints(plane, runway) {
	var r = getCircleRadius(plane), numOfPoints = 32, points = [], radianInc = 2 * Math.PI / numOfPoints;
	for (var i = 0; i < numOfPoints; i++) {
		points.push({
			x: runway.x + r * Math.cos(i * radianInc),
			y: runway.y + r * Math.sin(i * radianInc)
		});
	}
	return points;
}

function getNextCirclePoint(plane, runway) {
	logger.info("current position");
	logger.info(plane.position);
	var points = circlePoints[plane.id];
	if (!points) {
		points = calculateCirclePoints(plane, runway);
		circlePoints[plane.id] = points;
	}
	var distance = Number.MAX_VALUE, pos = plane.position, index;
	for (var i = 0, n = points.length; i < n; i++) {
		var d = calculateDistance(pos.x, pos.y, points[i].x, points[i].y);
		if (d < distance) {
			distance = d;
			index = i;
		}
	}
	if (distance < 10) {
		index = (index + 1) % points.length;
	}
	logger.info("new position");
	logger.info(points[index]);
	return points[index];
}

function findLandingPosition(plane, runway) {
	if (plane.rotation < 0) {
		return {
			x: runway.x + 200,
			y: runway.y - 200
		};
	}
	else {
		return {
			x: runway.x - 200,
			y: runway.y - 200
		};
	}
}

function findLandingRotation(plane, runway) {
	return plane.rotation < 0 ? 30 : -30;
}

function getNextPoint(plane, runway) {
	var landingPosition = findLandingPosition(plane, runway);
	var landingRotation = findLandingRotation(plane, runway);
	var rotation = landingRotation > 0 ? landingRotation - 180 : landingRotation + 180;
	var controlPointStart = calculatePosition(plane.position, plane.rotation, plane.turn_speed, 3);
	var controlPointEnd = calculatePosition(landingPosition, rotation, plane.turn_speed, 3);
	var curve = [plane.position, controlPointStart, controlPointEnd, landingPosition];
	var position = bezier.pointOnCurve(curve, 0.2);
	return position;
}

function getPlaneWaypoint(plane, runway) {
	if (isLandingPossible(plane, runway)) {
		return {
			x: runway.x,
			y: runway.y
		};
	}
	else {
		return getNextPoint(plane, runway);
	}
}

function findCollisions(planes) {
	var rects = _.map(planes, function(plane) {
		var rect = new g.Rect({
			x: plane.position.x - plane.collision_radius,
			y: plane.position.y - plane.collision_radius
		}, {
			width: 5 * plane.collision_radius,
			height: 5 * plane.collision_radius
		});
		rect._plane = plane;
		return rect;
	});
	var results = [];
	for (var i = 0, n = rects.length; i < n; i++) {
		for (var j = i + 1; j < n; j++) {
			if (rects[i].intersectsRect(rects[j])) {
				results.push([rects[i]._plane, rects[j]._plane]);
			}
		}
	}
	return _.uniq(results);
}

function getPositionToAvoidCollision(plane) {
	var pos = calculatePosition(plane.position, plane.rotation - 90, plane.turn_speed, 1);
	return pos;
}

function findNextPlaneToLand(planes, runway) {
	if (planeToLand) {
		return planeToLand;
	}
	var distance = Number.MAX_VALUE, p;
	planes = _.filter(planes, function(plane) {
		return isLandingPossible(plane, runway);
	});
	_.forEach(planes, function(plane) {
		var pos = plane.position;
		var d = calculateDistance(pos.x, pos.y, runway.x, runway.y);
		if (d < distance) {
			d = distance;
			p = plane;
		}
	});
	return p;
}

function getWaypointForPlaneToLand(plane, runway) {
	return runway;
}

function isPlaneLanded(plane, runway) {
	var pos = plane.position, distance = calculateDistance(pos.x, pos.y, runway.x, runway.y);
	return distance < 5;
}

exports.update = function(data) {
	var planes = _.filter(data.objects, function(obj) {
		return obj.type === 'plane';
	});
	var runway = data.runway;
	var waypoints = [];
	var collisions = findCollisions(planes);
	planeToLand = findNextPlaneToLand(planes, runway);
	_.forEach(collisions, function(collision) {
		
	});
	
	_.forEach(planes, function(plane) {
		var waypoint;
		if (_.contains(collisions, plane.id)) {
			waypoint = getPositionToAvoidCollision(plane);
		}
		else if (planeToLand && planeToLand.id === plane.id) {
			waypoint = getWaypointForPlaneToLand(plane,runway);
		}
		else {
			waypoint = getPlaneWaypoint(plane, runway);
		}
		waypoints.push({
			plane_id: plane.id,
			waypoint: waypoint
		});

		if (isPlaneLanded(plane, runway)) {
			logger.info("Plane landed %s", plane.id);
			planeToLand = null;
		}
	});
	logger.info(waypoints);
	return waypoints;
};