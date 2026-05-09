sealed class AppRoute {
  const AppRoute();

  const factory AppRoute.serverPicker() = ServerPickerRoute;
  const factory AppRoute.addServer() = AddServerRoute;
  const factory AppRoute.home() = HomeRoute;
  const factory AppRoute.session(String id) = SessionRoute;
  const factory AppRoute.channel(String id) = ChannelRoute;
  const factory AppRoute.recording(String id) = RecordingRoute;
  const factory AppRoute.notifications() = NotificationsRoute;
  const factory AppRoute.reauth() = ReauthRoute;
  const factory AppRoute.bridgeSpike() = BridgeSpikeRoute;

  String toPath() => switch (this) {
        ServerPickerRoute() => '/servers',
        AddServerRoute() => '/servers/add',
        HomeRoute() => '/home',
        SessionRoute(:final id) => '/m/session/$id',
        ChannelRoute(:final id) => '/m/channel/$id',
        RecordingRoute(:final id) => '/m/recording/$id',
        NotificationsRoute() => '/notifications',
        ReauthRoute() => '/reauth',
        BridgeSpikeRoute() => '/spike',
      };
}

final class ServerPickerRoute extends AppRoute {
  const ServerPickerRoute();
}

final class AddServerRoute extends AppRoute {
  const AddServerRoute();
}

final class HomeRoute extends AppRoute {
  const HomeRoute();
}

final class SessionRoute extends AppRoute {
  const SessionRoute(this.id);
  final String id;
}

final class ChannelRoute extends AppRoute {
  const ChannelRoute(this.id);
  final String id;
}

final class RecordingRoute extends AppRoute {
  const RecordingRoute(this.id);
  final String id;
}

final class NotificationsRoute extends AppRoute {
  const NotificationsRoute();
}

final class ReauthRoute extends AppRoute {
  const ReauthRoute();
}

final class BridgeSpikeRoute extends AppRoute {
  const BridgeSpikeRoute();
}
