const jwt = require('jsonwebtoken');

// Verify JWT token
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer <token>"

    if (!token) {
        return res.status(401).send('Access token required.');
    }

    try {
        const decoded = jwt.verify(token, process.env.SECRET); 
        req.user = decoded; // attach decoded payload (id, role) to request
        next();
    } catch (err) {
        return res.status(403).send('Invalid or expired token.');
    }
}

// Role-based middleware factory
function checkRole(...allowedRoles) {
    return (req, res, next) => {
        if (req.user && allowedRoles.includes(req.user.role)) {
            next();
        } else {
            res.status(403).send('You do not have permission to access this.');
        }
    };
}

module.exports = { verifyToken, checkRole };

