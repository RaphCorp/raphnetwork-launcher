<?php
$instance['RaphNetwork Modded'] = array_merge($instance['RaphNetwork Modded'], array(
    "loader" => array(
        "minecraft_version" => "1.21.1",
        "loader_type" => "neoforge",
        "loader_version" => "latest"
    ),
    "verify" => true,
    "ignored" => array(
        'essential',
        'logs',
        'resourcepacks',
        'saves',
        'screenshots',
        'shaderpacks',
        'W-OVERFLOW',
        'options.txt',
        'optionsof.txt'
    ),
    "whitelist" => array(),
    "whitelistActive" => false,
    "status" => array(
        "nameServer" => "RaphNetwork Modded",
        "ip" => "node1.raphhosting.com",
        "port" => 10004
    )
));

$instance['RaphCorp Research Facility'] = array_merge($instance['RaphCorp Research Facility'], array(
    "loader" => array(
        "minecraft_version" => "1.20.1",
        "loader_type" => "forge",
        "loader_version" => "1.20.1-47.3.0"
    ),
    "verify" => true,
    "ignored" => array(
        'essential',
        'logs',
        'resourcepacks',
        'saves',
        'screenshots',
        'shaderpacks',
        'W-OVERFLOW',
        'options.txt',
        'optionsof.txt'
    ),
    "whitelist" => array(
    	"raph_rapide100",
        "mouloude",
        "Nexus6919",
        "KartoffelFr",
        "Miniouinouin"
    ),
    "whitelistActive" => true,
    "status" => array(
        "nameServer" => "RRF - Neo",
        "ip" => "node1.raphhosting.com",
        "port" => 10005
    )
));

$instance['Survie'] = array_merge($instance['Survie'], array(
    "loader" => array(
        "minecraft_version" => "1.21.1",
        "loader_type" => "neoforge",
        "loader_version" => "21.1.219"
    ),
    "verify" => true,
    "ignored" => array(
        'essential',
        'logs',
        'resourcepacks',
        'saves',
        'screenshots',
        'shaderpacks',
        'W-OVERFLOW',
        'options.txt',
        'optionsof.txt'
    ),
    "whitelist" => array(
    	"raph_rapide100",
        "mouloude",
        "Nexus6919",
        "KartoffelFr"
    ),
    "whitelistActive" => true,
    "status" => array(
        "nameServer" => "Survie",
        "ip" => "node1.raphhosting.com",
        "port" => 10008
    )
));
?>
