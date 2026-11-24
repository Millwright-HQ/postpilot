/** @type {import('next').NextConfig} */
export default {
  // The UI is a static page in /public; serve it at / and /login.
  async rewrites() {
    return [
      { source: '/', destination: '/app.html' },
      { source: '/login', destination: '/login.html' },
    ];
  },
};
