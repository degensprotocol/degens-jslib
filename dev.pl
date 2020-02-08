#!/usr/bin/env perl

use strict;

use lib '../buildlib/lib/';
use BuildLib;


my $cmd = shift;

if ($cmd eq 'dist') {
  BuildLib::fpm({
    types => [qw/ deb /],
    name => 'degens-jslib',
    files => {
      'DegensUtils.js' => '/usr/degens/jslib/DegensUtils.js',
      'OrderbookClient.js' => '/usr/degens/jslib/OrderbookClient.js',
      'DegensContractLib.js' => '/usr/degens/jslib/DegensContractLib.js',
      '../../degens-contract/build/Degens.json' => '/usr/degens/jslib/Degens.json',
    },
    deps => [qw/
      degens-common-nodemodules
      nodejs
    /],
    description => 'degens-jslib',
  });
} else {
  die "unknown command: $cmd";
}
