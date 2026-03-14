const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: {
    'background': './src/background/index.ts',
    'content/indeed': './src/content/indeed.ts',
    'content/mainworld': './src/content/mainworld.ts',
    'content/smartapply': './src/content/smartapply.ts',
    'content/linkedin': './src/content/linkedin.ts',
    'content/generic-form': './src/content/generic-form.ts',
    'popup/popup': './src/popup/popup.ts',

  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  optimization: {
    // Disable code splitting — service workers can't load dynamic chunks
    splitChunks: false,
    runtimeChunk: false,
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
    alias: {
      '@jobpilot/types': path.resolve(__dirname, '../../packages/types/src'),
    },
  },
  plugins: [
    new webpack.DefinePlugin({
      'process.env.BACKEND_URL': JSON.stringify(process.env.BACKEND_URL || 'http://localhost:8004'),
    }),
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
        { from: 'src/popup/popup.html', to: 'popup/' },
        { from: 'src/popup/popup.css', to: 'popup/' },
        { from: 'assets', to: 'assets' },
      ],
    }),
  ],
  devtool: 'cheap-module-source-map',
};
