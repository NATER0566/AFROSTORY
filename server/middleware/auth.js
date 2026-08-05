import jwt from 'jsonwebtoken';

export const requireAuth = async (req, reply) => {
  try {
    // Extract the secure HttpOnly cookie (named afro_auth)
    const token = req.cookies.afro_auth;
    
    if (!token) {
      return reply.code(401).send({ 
        success: false, 
        message: 'Authentication required. Please log in.' 
      });
    }

    // Cryptographically verify the token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user payload (userId, role) to the request for the next steps
    req.user = decoded; 
  } catch (error) {
    req.log.error(`Auth Middleware Error: ${error.message}`);
    // Clear the dead/tampered cookie to protect the user
    reply.clearCookie('afro_auth', { path: '/' });
    return reply.code(401).send({ 
      success: false, 
      message: 'Session invalid or expired. Please log in again.' 
    });
  }
};

// Optional: Role-based gatekeeper for Admin-only routes
export const requireAdmin = async (req, reply) => {
  if (req.user?.role !== 'ADMIN') {
    return reply.code(403).send({ 
      success: false, 
      message: 'Access denied. Administrator privileges required.' 
    });
  }
};