const resolve = require('path').resolve;

const CopyPlugin = require('copy-webpack-plugin');
const ExtractCSSPlugin = require('mini-css-extract-plugin');
const LocalizePlugin = require('webpack-localize-assets-plugin');

const BUILD_DIR = resolve(__dirname, 'dist');

const copyAssets = new CopyPlugin({
  patterns: [
    {
      from: './assets',
      to: 'assets',
      globOptions: {
        ignore: ['*.svg'],
      },
    },
  ],
});
const copySite = new CopyPlugin({ patterns: [{ from: './example', to: './' }] });

const extractSass = new ExtractCSSPlugin({ filename: 'leaflet-measure.css' });

const locales = { en: './languages/en.json' };

module.exports = {
  mode: 'development',
  entry: ['./src/leaflet-measure.js'],
  output: {
    filename: 'leaflet-measure.[locale].js',
    path: BUILD_DIR,
  },
  devServer: {
    static: BUILD_DIR,
  },
  module: {
    rules: [
      {
        test: /\.html$/,
        use: { loader: 'html-loader', options: { interpolate: true } },
      },
      {
        test: /\.scss$/i,
        use: [
          ExtractCSSPlugin.loader,
          { loader: 'css-loader', options: { sourceMap: true } },
          { loader: 'resolve-url-loader', options: { sourceMap: true, root: '' } },
          {
            loader: 'sass-loader',
            options: {
              sourceMap: true,
            },
          },
        ],
      },
    ],
  },
  plugins: [copySite, copyAssets, extractSass, new LocalizePlugin({ locales })],
  devtool: 'eval-source-map',
};
