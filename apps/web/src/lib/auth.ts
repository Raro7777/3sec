import { SignJWT, jwtVerify, JWTPayload } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_for_development_purposes_only';
const encodedSecret = new TextEncoder().encode(JWT_SECRET);

export interface SessionPayload extends JWTPayload {
    userId: string;
    email: string;
    role: string;
}

export async function encrypt(payload: SessionPayload) {
    return new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('7d')
        .sign(encodedSecret);
}

export async function decrypt(session: string | undefined = '') {
    try {
        if (!session) return null;

        const { payload } = await jwtVerify(session, encodedSecret, {
            algorithms: ['HS256'],
        });

        return payload as SessionPayload;
    } catch (error) {
        return null;
    }
}
