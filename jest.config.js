module.exports = {
  testEnvironment: 'jsdom',
  transformIgnorePatterns: [
    "node_modules/(?!(jsdom|@exodus|html-encoding-sniffer|whatwg-encoding|webidl-conversions|cssstyle|cssom|saxes|@exodus/bytes)/)"
  ]
};
